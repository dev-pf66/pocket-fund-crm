import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

function authenticate(req) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key
  const validKey = process.env.CRM_API_KEY
  return apiKey === validKey
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!authenticate(req)) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid x-api-key header.' })
  }

  const { transcript_id, transcript_text } = req.body

  if (!transcript_id || !transcript_text) {
    return res.status(400).json({ error: 'transcript_id and transcript_text are required' })
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Analyse this sales call transcript and respond with a JSON object only — no markdown, no explanation.

Transcript:
${transcript_text}

Respond with this exact JSON structure:
{
  "summary": "2-3 sentence recap of the call",
  "sentiment": "Positive" | "Neutral" | "Negative",
  "fit_score": 1-5,
  "fit_reasoning": "one sentence explaining the score",
  "next_step": "single most important action to take"
}`
        }
      ]
    })

    const rawText = message.content[0].text.trim()

    // Strip markdown code fences if present
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let analysis
    try {
      analysis = JSON.parse(jsonText)
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response', raw: rawText })
    }

    // Validate and clamp values
    const validatedAnalysis = {
      summary: String(analysis.summary || ''),
      sentiment: ['Positive', 'Neutral', 'Negative'].includes(analysis.sentiment)
        ? analysis.sentiment
        : 'Neutral',
      fit_score: Math.min(5, Math.max(1, parseInt(analysis.fit_score) || 3)),
      fit_reasoning: String(analysis.fit_reasoning || ''),
      next_step: String(analysis.next_step || ''),
      analysed_at: new Date().toISOString()
    }

    // Save to database
    const { error: updateError } = await supabase
      .from('crm_transcripts')
      .update({ ai_analysis: validatedAnalysis })
      .eq('id', transcript_id)

    if (updateError) throw updateError

    return res.status(200).json({ success: true, analysis: validatedAnalysis })
  } catch (error) {
    console.error('analyze-transcript error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
