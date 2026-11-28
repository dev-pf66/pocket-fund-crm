// Claude fallback for typed reminders (Dev, 2026-11-28). The browser parser
// (src/lib/reminderParse.js) reads the common phrases instantly and for free;
// only what it can't read ("after Diwali", "once their fund closes in spring")
// comes here. Dispatched from api/analyze-transcript.js on
// `action: 'parse_reminder'` — NOT its own file: the Hobby plan caps a
// deployment at 12 function files and api/ is at 12.
//
// The answer is a SUGGESTION. The UI shows the date and the reason and the
// person confirms or changes it before anything is saved. A null date is a
// valid answer and better than a confident wrong one.

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MODEL = 'claude-haiku-5-5'

function weekdayName(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

export function reminderPrompt(text, today) {
  return `Today is ${weekdayName(today)} ${today} (India, IST). A salesperson at an Indian firm typed this note after talking to a lead:

"""${text}"""

When should they reach back out? Pick ONE calendar date strictly after today.
- Prefer a Monday–Friday. "Start of" a month = its first working day (skip Jan 1). "End of year" = mid-December.
- Indian festivals and holidays: use the date they fall on in the coming year, then the first working day after.
- If the note names no time at all, or you genuinely cannot tell, answer null. Do not invent a date.

Respond with JSON only, no markdown:
{"date": "YYYY-MM-DD" or null, "rule": "under 8 words: what you understood, e.g. 'week after Diwali'"}`
}

/** Validate Claude's answer: a well-formed date after today, or null. */
export function cleanReminderAnswer(raw, today) {
  const jsonText = String(raw || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  let parsed
  try { parsed = JSON.parse(jsonText) } catch { return { date: null, rule: '' } }
  const date = typeof parsed?.date === 'string' && ISO.test(parsed.date) && parsed.date > today
    && !Number.isNaN(new Date(parsed.date + 'T12:00:00Z').getTime())
    ? parsed.date : null
  return { date, rule: String(parsed?.rule || '').slice(0, 80) }
}

export async function handleParseReminder(req, res, anthropic) {
  const text = String(req.body?.text || '').trim().slice(0, 1000)
  const today = String(req.body?.today || '')
  if (!text) return res.status(400).json({ success: false, error: 'text is required' })
  if (!ISO.test(today)) return res.status(400).json({ success: false, error: 'today (YYYY-MM-DD) is required' })

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: reminderPrompt(text, today) }]
    })
    const answer = cleanReminderAnswer(message.content?.[0]?.text, today)
    return res.status(200).json({ success: true, ...answer })
  } catch (error) {
    console.error('parse_reminder error:', error)
    return res.status(500).json({ success: false, error: error.message })
  }
}
