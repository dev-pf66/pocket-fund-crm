#!/usr/bin/env node
/**
 * CallHippo schema discovery.
 *
 * Their OpenAPI spec (web.callhippo.com/api-docs) documents the REQUEST for
 * POST /v1/activityfeed but ships `"responses": {}` — no response schema and
 * no definitions at all. So the only honest way to build the connector is to
 * call it once and look.
 *
 * This prints the field names on a real call record, their types, and one
 * redacted sample, so the field mapping is written against what the API
 * actually returns rather than against a guess.
 *
 * Usage:
 *   CALLHIPPO_API_TOKEN=xxx node scripts/callhippo-discover.js [days]
 *
 * Reads nothing else and writes nothing anywhere. Phone numbers and names in
 * the sample are masked — the output is safe to paste into a chat.
 */

const TOKEN = process.env.CALLHIPPO_API_TOKEN
const DAYS = Number(process.argv[2] || 7)
const BASE = 'https://web.callhippo.com/v1'

if (!TOKEN) {
  console.error('Set CALLHIPPO_API_TOKEN. Get it from CallHippo → Integrations → REST API.')
  process.exit(1)
}

// Their date format is YYYY/MM/DD (pattern-enforced in the spec).
const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`

// Keys whose value is a person's contact detail whatever shape it arrives in.
// CallHippo nests caller/callee objects, and a number delivered as a JSON
// number rather than a string sails straight past a string-only mask.
const CONTACT_KEY = /phone|number|mobile|callerid|caller|callee|contact|^from$|^to$/i

/**
 * Mask anything that looks like a phone number or an email — recursively,
 * because the interesting fields are nested and the whole promise of this
 * script is that its output is safe to paste into a chat. `key` is the field
 * the value arrived under, so a bare numeric phone can be caught by name.
 */
function redact(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => redact(v, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
  }
  if (typeof value === 'number' && CONTACT_KEY.test(key)) {
    return `[masked, ${String(Math.trunc(Math.abs(value))).length} digits]`
  }
  if (typeof value !== 'string') return value
  const masked = value
    .replace(/\+?\d[\d\s\-().]{6,}\d/g, (m) => `${m.slice(0, 3)}…${m.slice(-2)} [${m.replace(/\D/g, '').length} digits]`)
    .replace(/[\w.+-]+@[\w.-]+/g, 'name@masked')
  // A short number under a phone-ish key (an extension, a 6-digit local line)
  // is below the pattern's threshold but still someone's line.
  if (masked === value && CONTACT_KEY.test(key) && /\d/.test(value)) {
    return `[masked, ${value.replace(/\D/g, '').length} digits]`
  }
  return masked
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array[${value.length}]${value.length ? ` of ${describe(value[0])}` : ''}`
  if (typeof value === 'object') return `object{${Object.keys(value).join(', ')}}`
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'string (ISO date)'
    if (/^https?:\/\//.test(value)) return 'string (URL)'
    if (/^CA[0-9a-f]{32}$/.test(value)) return 'string (Twilio call SID)'
    return 'string'
  }
  return typeof value
}

async function main() {
  const end = new Date()
  const start = new Date(Date.now() - DAYS * 86400000)

  const body = { skip: '0', limit: '20', startDate: fmt(start), endDate: fmt(end), apiToken: TOKEN }
  console.log(`POST ${BASE}/activityfeed  ${fmt(start)} → ${fmt(end)}\n`)

  const res = await fetch(`${BASE}/activityfeed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apiToken: TOKEN },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  console.log(`HTTP ${res.status} ${res.statusText}`)
  console.log(`content-type: ${res.headers.get('content-type')}\n`)

  let json
  try {
    json = JSON.parse(text)
  } catch {
    // An HTML body here means the route doesn't exist or we were bounced to a
    // login page — the same 200-with-a-shell trap our own apps have.
    console.log('Response was not JSON. First 400 chars:\n')
    console.log(text.slice(0, 400))
    process.exit(1)
  }

  console.log('=== TOP-LEVEL SHAPE ===')
  for (const [k, v] of Object.entries(json)) console.log(`  ${k}: ${describe(v)}`)

  // Find the array of call records wherever they hung it.
  // Confirmed shape (Sept 2026): { success, data: { callLogs: [...], hasNext } }.
  // The fallbacks stay for the day they reshape it.
  const deepFindArray = (o, depth = 0) => {
    if (depth > 3 || !o || typeof o !== 'object') return null
    for (const v of Object.values(o)) if (Array.isArray(v) && v.length) return v
    for (const v of Object.values(o)) {
      const found = deepFindArray(v, depth + 1)
      if (found) return found
    }
    return null
  }
  const records =
    (Array.isArray(json.data?.callLogs) && json.data.callLogs) ||
    (Array.isArray(json) && json) ||
    (Array.isArray(json.data) && json.data) ||
    deepFindArray(json)

  if (!records?.length) {
    console.log('\nNo call records in the window. Try a wider one: node scripts/callhippo-discover.js 30')
    console.log('\nRaw (first 600 chars):\n' + JSON.stringify(json).slice(0, 600))
    return
  }

  console.log(`\n=== ${records.length} RECORD(S). FIELDS ON THE FIRST ===`)
  for (const [k, v] of Object.entries(records[0])) {
    console.log(`  ${k.padEnd(28)} ${describe(v).padEnd(34)} e.g. ${JSON.stringify(redact(v, k)).slice(0, 60)}`)
  }

  // Union of keys — records vary by call type, and a field that only appears
  // on answered calls is exactly the one the mapper must not assume.
  const allKeys = new Set()
  for (const r of records) Object.keys(r).forEach((k) => allKeys.add(k))
  const firstKeys = new Set(Object.keys(records[0]))
  const extra = [...allKeys].filter((k) => !firstKeys.has(k))
  if (extra.length) console.log(`\n=== FIELDS PRESENT ONLY ON SOME RECORDS ===\n  ${extra.join(', ')}`)

  console.log('\n=== WHAT WE NEED, AND WHETHER IT IS THERE ===')
  const want = {
    'unique call id': /sid|callid|_id|uuid/i,
    'direction (in/out)': /direction|calltype|type/i,
    'to / dialled number': /to|callee|destination/i,
    'from number': /from|caller|source/i,
    'duration': /duration|talktime|billsec/i,
    'answered / status': /status|state|answered|disposition/i,
    'recording URL': /record/i,
    'agent / user': /agent|user|member/i,
    'timestamp': /date|time|created/i,
    'our crmUniqueId': /crmunique|crmid/i,
  }
  for (const [label, re] of Object.entries(want)) {
    const hits = [...allKeys].filter((k) => re.test(k))
    console.log(`  ${label.padEnd(22)} ${hits.length ? '✓ ' + hits.join(', ') : '✗ not found'}`)
  }
}

main().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})
