import { useEffect, useState } from 'react'
import { Tag as TagIcon, Plus, Check, X } from 'lucide-react'
import { getTags, getTagUsage, createTag, renameTag } from '../lib/crm-api'
import { useToast } from './Toast'

/**
 * Create and rename tags, with usage counts.
 *
 * `crm_tags` has existed since migration 003 and the app could read, assign and
 * unassign tags — but never CREATE one. So the vocabulary was frozen at the 8 rows
 * that migration seeded, which is why "Met at Conference" exists as a generic
 * label and no actual conference name ever could. 8 lead-tag links existed across
 * 596 leads: the feature was three-quarters built and therefore unused.
 *
 * Dev, Sept 2026: "more tags like the conference I met them at or if they came
 * through linkedin, so we can create lists." The list part lives on the Pipeline
 * board's Tag filter; this is where the vocabulary is managed.
 *
 * Rename rather than delete: `crm_lead_tags` points at the id, so renaming carries
 * every lead with it — a conference name typed wrong once is fixable without
 * re-tagging anyone. Nothing here deletes a tag; removing one would silently strip
 * it from every lead that carries it.
 *
 * TAGS ARE NOT `lead_channel`. Channel is a closed vocabulary for one countable
 * question — is inbound or outbound working. Tags are open-ended and arbitrary:
 * "SaaS Connect 2026", "intro via Aum", "wants Shopify stores". Don't collapse
 * one into the other.
 */

function TagManager() {
  const { toast } = useToast()
  const [tags, setTags] = useState([])
  const [usage, setUsage] = useState(new Map())
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  async function refresh() {
    const [list, counts] = await Promise.all([
      getTags().catch(() => []),
      getTagUsage().catch(() => new Map()),
    ])
    setTags(list)
    setUsage(counts)
  }

  useEffect(() => { refresh() }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    try {
      const t = await createTag(newName)
      // createTag returns the existing tag on a case-insensitive name match, so
      // say which happened rather than implying something new was made.
      const existed = tags.some(x => x.id === t.id)
      toast.success(existed ? `"${t.name}" already existed` : `Created "${t.name}"`)
      setNewName('')
      await refresh()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(id) {
    if (!editName.trim()) { setEditingId(null); return }
    setBusy(true)
    try {
      await renameTag(id, editName)
      toast.success('Tag renamed — every lead carrying it follows')
      setEditingId(null)
      await refresh()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}>
        <TagIcon size={18} /> Tags
      </h3>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Free-form labels for making lists — the conference you met someone at, who
        introduced them, what they are hunting for. Filter by one on the Pipeline
        board to get the list. For the countable inbound-vs-outbound split use
        <strong> How they found us</strong> on the lead instead; that one has a fixed
        vocabulary on purpose.
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ flex: '1 1 260px' }}
          placeholder='e.g. "SaaS Connect 2026", "intro via Aum"'
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={100}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !newName.trim()}>
          <Plus size={14} /> Add tag
        </button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ textAlign: 'left', padding: '8px' }}>Tag</th>
            <th style={{ textAlign: 'right', padding: '8px' }}>Leads</th>
            <th style={{ textAlign: 'right', padding: '8px' }}></th>
          </tr>
        </thead>
        <tbody>
          {tags.map(t => (
            <tr key={t.id} style={{ borderTop: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px' }}>
                {editingId === t.id ? (
                  <input
                    className="form-input" style={{ width: '100%', maxWidth: '300px' }}
                    value={editName} autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(t.id); if (e.key === 'Escape') setEditingId(null) }}
                  />
                ) : (
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: '999px',
                    fontSize: '12px', fontWeight: 600, color: 'white', background: t.color || '#3b82f6'
                  }}>{t.name}</span>
                )}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (usage.get(t.id) || 0) === 0 ? '#9ca3af' : '#111827' }}>
                {usage.get(t.id) || 0}
              </td>
              <td style={{ padding: '8px', textAlign: 'right' }}>
                {editingId === t.id ? (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => handleRename(t.id)} disabled={busy}><Check size={13} /></button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)} style={{ marginLeft: 6 }}><X size={13} /></button>
                  </>
                ) : (
                  <button className="btn btn-sm btn-secondary" onClick={() => { setEditingId(t.id); setEditName(t.name) }}>Rename</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '10px', fontSize: '12px', color: '#6b7280' }}>
        Renaming carries every lead that has the tag. There is no delete — removing a
        tag would strip it from every lead silently; rename it instead.
      </div>
    </div>
  )
}

export default TagManager
