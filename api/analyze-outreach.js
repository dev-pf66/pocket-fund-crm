import Anthropic from '@anthropic-ai/sdk'
import { isAuthorized } from './_auth.js'
import { requireEnv } from './_env.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

function avgWords(arr) {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((s, e) => s + wordCount(e.message_content), 0) / arr.length)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireEnv(res, ['ANTHROPIC_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])) return
  if (!(await isAuthorized(req))) return res.status(401).json({ error: 'Unauthorized' })

  const { entries } = req.body
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' })
  }

  const withText = entries.filter(e => e.message_content && String(e.message_content).trim().length > 10)
  if (withText.length < 3) {
    return res.status(400).json({
      error: `Not enough messages with text (found ${withText.length}, need at least 3)`
    })
  }

  const replied = withText.filter(e => e.status === 'replied')
  const notReplied = withText.filter(e => e.status !== 'replied')

  const formatMessages = (arr, max = 15) =>
    arr.slice(0, max).map((m, i) => `[${i + 1}] "${String(m.message_content).trim()}"`).join('\n\n')

  const prompt = `You are analyzing cold outreach messages to identify what patterns correlate with getting a reply.

MESSAGES THAT GOT REPLIES (${replied.length} total):
${replied.length > 0 ? formatMessages(replied) : '(none in this sample)'}

MESSAGES THAT DID NOT GET REPLIES (${notReplied.length} total):
${notReplied.length > 0 ? formatMessages(notReplied) : '(none in this sample)'}

Analyze the actual content differences between the two groups. Focus only on what is really in these messages — do not give generic sales advice.

Respond with this exact JSON structure (no markdown, no explanation outside the JSON):
{
  "summary": "one sentence: how many messages analyzed, reply rate, and the single most important pattern",
  "observations": [
    { "insight": "specific pattern you actually see in the data", "evidence": "short phrase or characteristic directly from the messages above" }
  ],
  "avg_words_replied": ${avgWords(replied)},
  "avg_words_not_replied": ${avgWords(notReplied)},
  "low_data": ${replied.length < 5}
}

Rules:
- 3 to 5 observations, no more
- Only cite patterns actually present in the messages — no invented examples
- If the two groups look similar, say so honestly rather than forcing a pattern
- Keep each insight under 25 words
- Keep each evidence under 15 words`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })

    const rawText = message.content[0].text.trim()
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let analysis
    try {
      analysis = JSON.parse(jsonText)
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response', raw: rawText })
    }

    return res.status(200).json({
      success: true,
      analysis: {
        summary: String(analysis.summary || ''),
        observations: Array.isArray(analysis.observations) ? analysis.observations.slice(0, 5) : [],
        avg_words_replied: Number(analysis.avg_words_replied) || avgWords(replied),
        avg_words_not_replied: Number(analysis.avg_words_not_replied) || avgWords(notReplied),
        low_data: Boolean(analysis.low_data),
        total_analyzed: withText.length,
        replied_count: replied.length,
        analyzed_at: new Date().toISOString()
      }
    })
  } catch (error) {
    console.error('analyze-outreach error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
