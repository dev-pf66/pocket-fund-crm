require('dotenv').config();
const { Bot } = require('grammy');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./prompts');
const { TOOLS, executeTool } = require('./actions');

// Validate required env vars
const required = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error('Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Per-chat conversation history (in-memory, resets on restart)
const chatHistories = new Map();

function getHistory(chatId) {
  if (!chatHistories.has(chatId)) {
    chatHistories.set(chatId, []);
  }
  return chatHistories.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Keep last 20 messages to avoid context overflow
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

// Format tool result for display in Telegram
function formatToolResult(toolName, result) {
  if (!result.success) {
    return `❌ ${result.error}`;
  }

  switch (toolName) {
    case 'add_lead': {
      const l = result.lead;
      return `✅ *${l.contact_name}* (${l.company_name}) added → ${l.stage}${l.score ? ` | Score: ${l.score}/5` : ''}`;
    }
    case 'update_lead': {
      const l = result.lead;
      return `✅ Updated *${l.contact_name}* (${l.company_name})\nStage: ${l.stage}${l.score ? ` | Score: ${l.score}/5` : ''}`;
    }
    case 'log_outreach': {
      const l = result.lead;
      return `✅ Logged ${result.outreach.platform} outreach for *${l.contact_name}* (${l.company_name})`;
    }
    case 'get_leads': {
      if (result.leads.length === 0) {
        return '🔍 No leads found.';
      }
      const lines = result.leads.map(l => {
        const score = l.score ? ` ⭐${l.score}` : '';
        return `• *${l.contact_name}* (${l.company_name}) → ${l.stage}${score}`;
      });
      return `🔍 Found ${result.count} lead(s):\n${lines.join('\n')}`;
    }
    default:
      return `✅ Done`;
  }
}

async function handleMessage(ctx, userText) {
  const chatId = ctx.chat.id;

  // Add user message to history
  addToHistory(chatId, 'user', userText);

  try {
    // First Claude call
    let response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: getHistory(chatId)
    });

    // Agentic loop — keep going until no more tool calls
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      // If Claude has text alongside tool calls, send it first
      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text).join('\n').trim();
        if (text) {
          await ctx.reply(text, { parse_mode: 'Markdown' });
        }
      }

      // Add Claude's response (with tool_use blocks) to history
      addToHistory(chatId, 'assistant', response.content);

      // Execute each tool call
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);
        const displayText = formatToolResult(toolUse.name, result);

        // Send tool result to user immediately
        await ctx.reply(displayText, { parse_mode: 'Markdown' });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // Add tool results to history
      addToHistory(chatId, 'user', toolResults);

      // Call Claude again with tool results
      response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: getHistory(chatId)
      });
    }

    // Final text response from Claude
    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (finalText) {
      await ctx.reply(finalText, { parse_mode: 'Markdown' });
      addToHistory(chatId, 'assistant', finalText);
    }

  } catch (err) {
    console.error('Error handling message:', err);
    await ctx.reply(`❌ Error: ${err.message}`);
  }
}

// /start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 *Pocket Fund CRM Bot*\n\nI can help you manage your lead pipeline\\. Try:\n\n` +
    `• "Add new lead — John Smith from TechBiz, contacted via LinkedIn"\n` +
    `• "Move Sarah at Acme to qualified"\n` +
    `• "Log outreach to Mike — sent LinkedIn DM"\n` +
    `• "Show me leads in the contacted stage"\n` +
    `• "Show recent leads"`,
    { parse_mode: 'Markdown' }
  );
});

// /clear command to reset conversation history
bot.command('clear', async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  await ctx.reply('🗑 Conversation history cleared.');
});

// /help command
bot.command('help', async (ctx) => {
  await ctx.reply(
    `*Available commands:*\n\n` +
    `/start — Welcome message\n` +
    `/help — Show this help\n` +
    `/clear — Clear conversation history\n\n` +
    `*What I can do:*\n` +
    `• Add leads: "Add John from Acme, new stage"\n` +
    `• Update leads: "Move John to qualified, score 4"\n` +
    `• Log outreach: "Log email outreach to Sarah at TechCo"\n` +
    `• Search leads: "Show leads in negotiating stage"\n` +
    `• Natural language: "Just spoke to Mike, good fit, move him forward"`,
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages
bot.on('message:text', async (ctx) => {
  await ctx.replyWithChatAction('typing');
  await handleMessage(ctx, ctx.message.text);
});

// Start the bot
bot.start({
  onStart: () => {
    console.log('🚀 Pocket Fund CRM Bot is running...');
    console.log('Press Ctrl+C to stop.');
  }
});

bot.catch((err) => {
  console.error('Bot error:', err);
});
