import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, AlertTriangle } from 'lucide-react'
import { createLead, findDuplicateLead } from '../lib/crm-api'
import { isLinkedInUrl, nameFromLinkedInUrl, linkedInProfileSlug } from '../lib/linkedin'
import { useApp } from '../App'
import { useToast } from './Toast'

const STAGE_LABELS = {
  outreach: 'New Leads (Outreach)',
  responded: 'Responded',
  meeting_booked: 'Meeting Booked',
  warm_active: 'Warm Leads (Active)',
  client: 'Clients',
  passed: 'Passed'
}

const MATCH_LABELS = {
  linkedin_url: 'the same LinkedIn profile',
  email: 'the same email address',
  name_firm: 'the same name and firm'
}

// A LinkedIn URL, or the old "Name - Firm" shorthand. The URL check runs
// first because profile slugs are full of hyphens and would otherwise be
// chopped in half by the shorthand split.
function parseQuickInput(text) {
  const trimmed = text.trim()

  if (isLinkedInUrl(trimmed)) {
    return {
      name: nameFromLinkedInUrl(trimmed),
      firm_name: '',
      linkedin_url: trimmed,
      lead_source: 'LinkedIn'
    }
  }

  const parts = trimmed.split(/[-–—]/).map(s => s.trim())
  return { name: parts[0], firm_name: parts[1] || '', linkedin_url: '' }
}

function QuickAddCard({ stage, onLeadCreated }) {
  const { currentPerson, people } = useApp()
  const { toast } = useToast()
  const [isAdding, setIsAdding] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // A duplicate we found and are showing the user before creating anything.
  const [duplicate, setDuplicate] = useState(null)
  // A URL whose slug wouldn't split into a name — we ask instead of guessing.
  const [needsName, setNeedsName] = useState(null)
  const [nameInput, setNameInput] = useState('')

  function reset() {
    setInput('')
    setDuplicate(null)
    setNeedsName(null)
    setNameInput('')
    setIsAdding(false)
  }

  async function create(draft) {
    setLoading(true)
    try {
      await createLead({ ...draft, stage }, currentPerson.id)
      reset()
      if (onLeadCreated) onLeadCreated()
    } catch (err) {
      console.error('Failed to create lead:', err)
      toast.error('Failed to create lead: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Everything that has cleared the duplicate check funnels through here, so
  // "Add anyway" can't skip the name prompt.
  function proceed(draft) {
    setDuplicate(null)
    if (draft.linkedin_url && !draft.name) {
      setNeedsName(draft)
      return
    }
    create(draft)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!input.trim() || loading) return

    if (!currentPerson?.id) {
      toast.error('Please wait — loading user info')
      return
    }

    const draft = parseQuickInput(input)
    if (!draft.name && !draft.linkedin_url) {
      toast.warn('Enter a name, "Name - Firm", or a LinkedIn URL')
      return
    }

    // Checked before the name prompt: the URL alone is enough to recognise
    // someone, so there's no point asking for a name we already have.
    setLoading(true)
    let match
    try {
      match = await findDuplicateLead(draft)
    } finally {
      setLoading(false)
    }

    if (match) {
      setDuplicate({ ...match, draft })
      return
    }
    // Deliberately outside the block above — proceed() owns the loading flag
    // for the create it kicks off.
    proceed(draft)
  }

  function handleNameSubmit(e) {
    e.preventDefault()
    const name = nameInput.trim()
    if (!name) {
      toast.warn('Enter a name for this profile')
      return
    }
    create({ ...needsName, name })
  }

  if (!isAdding) {
    return (
      <div className="quick-add-trigger" onClick={() => setIsAdding(true)}>
        <Plus size={16} />
        <span>Quick add...</span>
      </div>
    )
  }

  if (duplicate) {
    const { lead, matchedOn, draft } = duplicate
    const owner = people?.find(p => String(p.id) === String(lead.assigned_to))
    return (
      <div className="quick-add-card quick-add-duplicate">
        <div className="quick-add-duplicate-head">
          <AlertTriangle size={14} />
          <strong>Already in the pipeline</strong>
        </div>
        <Link to={`/leads/${lead.id}`} className="quick-add-duplicate-lead">
          {lead.name}{lead.firm_name ? ` — ${lead.firm_name}` : ''}
        </Link>
        <div className="quick-add-duplicate-meta">
          {STAGE_LABELS[lead.stage] || lead.stage}
          {owner ? ` · owned by ${owner.name}` : ' · unassigned'}
        </div>
        <div className="quick-add-hint">
          Matched on {MATCH_LABELS[matchedOn] || matchedOn}.
        </div>
        <div className="quick-add-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => proceed(draft)}
            disabled={loading}
          >
            Add anyway
          </button>
        </div>
      </div>
    )
  }

  if (needsName) {
    return (
      <form onSubmit={handleNameSubmit} className="quick-add-card">
        <div className="quick-add-hint">
          Couldn&apos;t read a name from <code>/in/{linkedInProfileSlug(needsName.linkedin_url)}</code> — what are they called?
        </div>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Full name"
          autoFocus
          disabled={loading}
        />
        <div className="quick-add-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
            {loading ? 'Adding...' : 'Add lead'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="quick-add-card">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Paste a LinkedIn URL, or Name - Firm"
        autoFocus
        disabled={loading}
        onBlur={() => {
          if (!input.trim()) setIsAdding(false)
        }}
      />
      <div className="quick-add-hint">
        {loading ? 'Checking for an existing lead...' : 'linkedin.com/in/john-smith — or — John Smith - Acme Capital'}
      </div>
    </form>
  )
}

export default QuickAddCard
