require('dotenv').config();
const { Bot } = require('grammy');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./prompts');
const { TOOLS, executeTool } = require('./actions');

// ─── Validate required env vars (never log their values) ──────────────────────
const required = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ALLOWED_USER_IDS'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ─── Allowlist: only these Telegram user IDs can use the bot ──────────────────
const ALLOWED_IDS = new Set(
  process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim(), 10))
);

// ─── Rate limiting: max 10 messages per 60 seconds per user ───────────────────
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map(); // userId → { count, windowStart }

function isRateLimited(userId) {
  const now = Date.now();
  const entry = rateLimitMap.get(userId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_WINDOW_MS) {
    // Reset window
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT) return true;

  entry.count++;
  rateLimitMap.set(userId, entry);
  return false;
}

// ─── Input sanitization ────────────────────────────────────────────────────────
const MAX_INPUT_LENGTH = 50000; // transcripts can be long

function sanitizeInput(text) {
  // Strip control characters (except newlines/tabs)
  // Cap length to prevent prompt injection via very long messages
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, MAX_INPUT_LENGTH);
}

// ─── Bot + Anthropic clients ──────────────────────────────────────────────────
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Per-user conversation history (in-memory, resets on restart) ─────────────
const chatHistories = new Map();

function getHistory(chatId) {
  if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
  return chatHistories.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

// ─── Security middleware: block all unauthorized users ────────────────────────
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;

  if (!userId || !ALLOWED_IDS.has(userId)) {
    console.warn(`[BLOCKED] Unauthorized access attempt from user ID: ${userId}`);
    await ctx.reply('⛔ You are not authorized to use this bot.');
    return;
  }

  if (isRateLimited(userId)) {
    await ctx.reply('⏳ Slow down — max 10 messages per minute.');
    return;
  }

  return next();
});

// ─── Escape HTML special chars so user data never breaks formatting ───────────
function h(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Format tool results for Telegram (HTML mode — safer than Markdown) ───────
function formatToolResult(toolName, result) {
  if (!result.success) return `❌ ${h(result.error)}`;

  switch (toolName) {
    case 'add_lead': {
      const l = result.lead;
      return `✅ <b>${h(l.contact_name)}</b> (${h(l.company_name)}) added → ${h(l.stage)}${l.score ? ` | Score: ${l.score}/5` : ''}`;
    }
    case 'update_lead': {
      const l = result.lead;
      return `✅ Updated <b>${h(l.contact_name)}</b> (${h(l.company_name)})\nStage: ${h(l.stage)}${l.score ? ` | Score: ${l.score}/5` : ''}`;
    }
    case 'log_outreach': {
      const l = result.lead;
      return `✅ Logged ${h(result.outreach.platform)} outreach for <b>${h(l.contact_name)}</b> (${h(l.company_name)})`;
    }
    case 'get_leads': {
      if (result.leads.length === 0) return '🔍 No leads found.';
      const lines = result.leads.map(l => {
        const score = l.score ? ` ⭐${l.score}` : '';
        return `• <b>${h(l.contact_name)}</b> (${h(l.company_name)}) → ${h(l.stage)}${score}`;
      });
      return `🔍 Found ${result.count} lead(s):\n${lines.join('\n')}`;
    }
    case 'log_transcript': {
      const l = result.lead;
      return `✅ Transcript saved for <b>${h(l.contact_name)}</b> (${h(l.company_name)})\n${result.charCount.toLocaleString()} characters saved`;
    }
    default:
      return `✅ Done`;
  }
}

// ─── Haiku pricing (per million tokens) ───────────────────────────────────────
const PRICE_INPUT_PER_M  = 0.80;  // $0.80 / 1M input tokens
const PRICE_OUTPUT_PER_M = 4.00;  // $4.00 / 1M output tokens

function calcCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000) * PRICE_INPUT_PER_M
       + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
}

// ─── Core AI handler ──────────────────────────────────────────────────────────
async function handleMessage(ctx, rawText) {
  const chatId = ctx.chat.id;
  const userText = sanitizeInput(rawText);

  addToHistory(chatId, 'user', userText);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    let response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: getHistory(chatId)
    });

    totalInputTokens  += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text).join('\n').trim();
        if (text) await ctx.reply(text, { parse_mode: 'HTML' });
      }

      addToHistory(chatId, 'assistant', response.content);

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);
        await ctx.reply(formatToolResult(toolUse.name, result), { parse_mode: 'HTML' });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      addToHistory(chatId, 'user', toolResults);

      response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: getHistory(chatId)
      });

      totalInputTokens  += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (finalText) {
      await ctx.reply(finalText, { parse_mode: 'HTML' });
      addToHistory(chatId, 'assistant', finalText);
    }

    // Cost footer
    const cost = calcCost(totalInputTokens, totalOutputTokens);
    await ctx.reply(
      `<i>🪙 ${totalInputTokens + totalOutputTokens} tokens · $${cost.toFixed(5)}</i>`,
      { parse_mode: 'HTML' }
    );

  } catch (err) {
    // Log the error type but NOT any content that might contain key material
    console.error(`[ERROR] ${err.constructor.name}: ${err.message}`);
    await ctx.reply(`❌ Something went wrong. Please try again.`);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 <b>Pocket Fund CRM Bot</b>\n\nManage your pipeline from Telegram:\n\n` +
    `• "Add new lead — John Smith from TechBiz, contacted via LinkedIn"\n` +
    `• "Move Sarah at Acme to qualified"\n` +
    `• "Log outreach to Mike — sent LinkedIn DM"\n` +
    `• "Show leads in contacted stage"`,
    { parse_mode: 'HTML' }
  );
});

bot.command('clear', async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  await ctx.reply('🗑 Conversation history cleared.');
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    `<b>Commands:</b>\n` +
    `/start — Welcome\n` +
    `/help — This message\n` +
    `/myid — Show your Telegram user ID\n` +
    `/clear — Reset conversation history\n\n` +
    `<b>What I can do:</b>\n` +
    `• Add leads\n• Update stage, score, notes\n• Log outreach\n• Search leads`,
    { parse_mode: 'HTML' }
  );
});

// Useful for getting user ID to add to allowlist
bot.command('myid', async (ctx) => {
  await ctx.reply(`Your Telegram user ID: \`${ctx.from.id}\``, { parse_mode: 'HTML' });
});

bot.on('message:text', async (ctx) => {
  await ctx.replyWithChatAction('typing');
  await handleMessage(ctx, ctx.message.text);
});

// ─── Start ────────────────────────────────────────────────────────────────────
bot.start({
  onStart: () => {
    console.log('🚀 Pocket Fund CRM Bot running');
    console.log(`Allowlist: ${ALLOWED_IDS.size} user(s) authorized`);
  }
});

bot.catch((err) => {
  console.error(`[BOT ERROR] ${err.constructor.name}:`, err.message);
});
