import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { stageMeta } from '../lib/stages'
import { Search, Users, Briefcase, Store, Handshake } from 'lucide-react'

// Global Cmd+K / Ctrl+K search across leads, investors, sellers and (for the
// owner) partners. Self-contained: queries Supabase directly so it doesn't
// add surface to crm-api. RLS scopes results the same as every page.

const GROUP_META = {
  lead: { label: 'Leads', icon: <Users size={14} /> },
  investor: { label: 'Investors', icon: <Briefcase size={14} /> },
  seller: { label: 'Indian Sellers', icon: <Store size={14} /> },
  partner: { label: 'Partners', icon: <Handshake size={14} /> }
}

async function runSearch(q, { includePartners }) {
  const like = `%${q}%`
  const queries = [
    supabase.from('crm_leads')
      .select('id, name, firm_name, email, stage')
      .or(`name.ilike.${like},firm_name.ilike.${like},email.ilike.${like}`)
      .limit(5)
      .then(r => (r.data || []).map(x => ({
        type: 'lead', id: x.id, title: x.name, sub: x.firm_name || x.email, stage: x.stage, to: `/leads/${x.id}`
      }))),
    supabase.from('crm_investors')
      .select('id, name, email')
      .or(`name.ilike.${like},email.ilike.${like}`)
      .limit(5)
      .then(r => (r.data || []).map(x => ({
        type: 'investor', id: x.id, title: x.name, sub: x.email, to: `/investors/${x.id}`
      }))),
    supabase.from('crm_sellers')
      .select('id, name, business_name, stage')
      .or(`name.ilike.${like},business_name.ilike.${like}`)
      .limit(5)
      .then(r => (r.data || []).map(x => ({
        type: 'seller', id: x.id, title: x.name, sub: x.business_name, to: '/sellers'
      })))
  ]
  if (includePartners) {
    queries.push(
      supabase.from('crm_partners')
        .select('id, name, company_name')
        .or(`name.ilike.${like},company_name.ilike.${like}`)
        .limit(5)
        .then(r => (r.data || []).map(x => ({
          type: 'partner', id: x.id, title: x.name, sub: x.company_name, to: '/partners'
        })))
    )
  }
  const settled = await Promise.allSettled(queries)
  return settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []))
}

function CommandPalette({ includePartners = false }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const seqRef = useRef(0)

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelected(0)
      // Focus after the modal paints
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current
      try {
        const found = await runSearch(q, { includePartners })
        if (seq === seqRef.current) {
          setResults(found)
          setSelected(0)
        }
      } finally {
        if (seq === seqRef.current) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, includePartners])

  const go = useCallback((item) => {
    setOpen(false)
    navigate(item.to)
  }, [navigate])

  function onInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(results.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(0, s - 1))
    } else if (e.key === 'Enter' && results[selected]) {
      e.preventDefault()
      go(results[selected])
    }
  }

  if (!open) return null

  // Group results while keeping a flat index for keyboard selection
  const groups = []
  results.forEach((item, idx) => {
    const last = groups[groups.length - 1]
    if (!last || last.type !== item.type) groups.push({ type: item.type, items: [] })
    groups[groups.length - 1].items.push({ ...item, idx })
  })

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '14vh', zIndex: 1100
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '92%', maxWidth: '560px', background: 'white',
          borderRadius: '12px', boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <Search size={18} style={{ color: '#9ca3af', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search leads, investors, sellers…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '15px', background: 'transparent' }}
          />
          <span style={{ fontSize: '11px', color: '#9ca3af', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '2px 6px', flexShrink: 0 }}>esc</span>
        </div>

        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {groups.map(group => (
            <div key={group.type}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px 4px', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {GROUP_META[group.type].icon} {GROUP_META[group.type].label}
              </div>
              {group.items.map(item => {
                const active = item.idx === selected
                const stage = item.stage ? stageMeta(item.stage) : null
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    onClick={() => go(item)}
                    onMouseEnter={() => setSelected(item.idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '9px 16px', cursor: 'pointer',
                      background: active ? '#eff6ff' : 'transparent'
                    }}
                  >
                    <span style={{ fontWeight: 500, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.title}
                    </span>
                    {item.sub && (
                      <span style={{ fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.sub}
                      </span>
                    )}
                    {stage && (
                      <span style={{
                        marginLeft: 'auto', flexShrink: 0, fontSize: '11px', fontWeight: 600,
                        padding: '2px 8px', borderRadius: '999px',
                        background: `${stage.color}22`, color: stage.color
                      }}>
                        {stage.label}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
              No matches for “{query.trim()}”
            </div>
          )}
          {query.trim().length < 2 && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
              Type at least 2 characters — ↑↓ to navigate, Enter to open
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
