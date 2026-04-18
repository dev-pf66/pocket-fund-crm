import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createLead } from '../lib/crm-api'
import { useApp } from '../App'
import { useToast } from './Toast'

function QuickAddCard({ stage, onLeadCreated }) {
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [isAdding, setIsAdding] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  function parseQuickInput(text) {
    const parts = text.split(/[-–—]/).map(s => s.trim())

    if (parts.length === 1) {
      return { name: parts[0], firm_name: '' }
    }

    return { name: parts[0], firm_name: parts[1] || '' }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!input.trim() || loading) return

    if (!currentPerson?.id) {
      toast.error('Please wait — loading user info')
      return
    }

    setLoading(true)
    try {
      const { name, firm_name } = parseQuickInput(input)
      await createLead({ name, firm_name, stage }, currentPerson.id)
      setInput('')
      setIsAdding(false)
      if (onLeadCreated) onLeadCreated()
    } catch (err) {
      console.error('Failed to create lead:', err)
      toast.error('Failed to create lead: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!isAdding) {
    return (
      <div
        className="quick-add-trigger"
        onClick={() => setIsAdding(true)}
      >
        <Plus size={16} />
        <span>Quick add...</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="quick-add-card">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Name - Firm (hit Enter)"
        autoFocus
        disabled={loading}
        onBlur={() => {
          if (!input.trim()) setIsAdding(false)
        }}
      />
      <div className="quick-add-hint">
        Example: John Smith - Acme Capital
      </div>
    </form>
  )
}

export default QuickAddCard
