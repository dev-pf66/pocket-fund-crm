import { useState, useRef, useEffect } from 'react'
import { Send, Terminal, X, Minimize2 } from 'lucide-react'
import { createLead } from '../lib/crm-api'
import { useApp } from '../App'

function ChatTerminal() {
  const { currentPerson } = useApp()
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    { type: 'system', text: 'Lead Terminal ready. Type naturally to add leads.' },
    { type: 'system', text: 'Example: "add john smith from acme capital, pe firm, looking for b2b saas"' }
  ])
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  function parseLead(text) {
    const lead = {
      name: '',
      firm_name: '',
      email: '',
      phone: '',
      linkedin_url: '',
      lead_type: '',
      deal_criteria: '',
      notes: '',
      stage: 'new_lead'
    }

    // Extract name (first thing after "add")
    const nameMatch = text.match(/add\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i)
    if (nameMatch) {
      lead.name = nameMatch[1].trim()
    }

    // Extract firm (after "from" or "at")
    const firmMatch = text.match(/(?:from|at)\s+([A-Za-z0-9\s&]+?)(?:,|$|\s+(?:pe|family|independent|looking))/i)
    if (firmMatch) {
      lead.firm_name = firmMatch[1].trim()
    }

    // Extract email
    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i)
    if (emailMatch) {
      lead.email = emailMatch[1]
    }

    // Extract phone
    const phoneMatch = text.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/i)
    if (phoneMatch) {
      lead.phone = phoneMatch[1]
    }

    // Extract LinkedIn URL
    const linkedinMatch = text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s,]+)/i)
    if (linkedinMatch) {
      lead.linkedin_url = linkedinMatch[1]
    }

    // Extract lead type
    if (/pe\s+firm|private\s+equity/i.test(text)) {
      lead.lead_type = 'PE Firm'
    } else if (/family\s+office/i.test(text)) {
      lead.lead_type = 'Family Office'
    } else if (/independent\s+sponsor/i.test(text)) {
      lead.lead_type = 'Independent Sponsor'
    }

    // Extract deal criteria
    const criteriaMatch = text.match(/looking\s+for\s+([^,.]+)/i)
    if (criteriaMatch) {
      lead.deal_criteria = criteriaMatch[1].trim()
    }

    // Extract stage
    if (/warm/i.test(text)) {
      lead.stage = 'warm_lead'
    } else if (/active|conversation/i.test(text)) {
      lead.stage = 'active_conversation'
    } else if (/client/i.test(text)) {
      lead.stage = 'client'
    }

    return lead
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setMessages(prev => [...prev, { type: 'user', text: userMessage }])
    setInput('')
    setLoading(true)

    try {
      // Check for commands
      if (userMessage.toLowerCase() === 'help') {
        setMessages(prev => [...prev, {
          type: 'system',
          text: `Commands:
• add [name] from [firm], [lead type], looking for [criteria]
• clear - Clear chat history
• help - Show this message

Examples:
• add john smith from acme capital, pe firm, looking for b2b saas
• add sarah jones, family office, sarah@jones.com
• add mike wilson at spectrum partners, independent sponsor, looking for healthcare deals`
        }])
        setLoading(false)
        return
      }

      if (userMessage.toLowerCase() === 'clear') {
        setMessages([
          { type: 'system', text: 'Chat cleared. Ready for new leads.' }
        ])
        setLoading(false)
        return
      }

      // Parse and create lead
      if (userMessage.toLowerCase().startsWith('add ')) {
        const leadData = parseLead(userMessage)

        if (!leadData.name) {
          setMessages(prev => [...prev, {
            type: 'error',
            text: 'Could not extract name. Try: "add John Smith from Acme Capital"'
          }])
          setLoading(false)
          return
        }

        leadData.created_by = currentPerson?.id

        const newLead = await createLead(leadData)

        setMessages(prev => [...prev, {
          type: 'success',
          text: `✓ Created lead: ${newLead.name}${newLead.firm_name ? ` (${newLead.firm_name})` : ''} in ${newLead.stage.replace(/_/g, ' ')}`
        }])
      } else {
        setMessages(prev => [...prev, {
          type: 'system',
          text: 'Use "add [name]..." to create a lead. Type "help" for examples.'
        }])
      }
    } catch (err) {
      console.error('Terminal error:', err)
      setMessages(prev => [...prev, {
        type: 'error',
        text: `Error: ${err.message}`
      }])
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="chat-terminal-bubble"
        title="Lead Terminal (Ctrl+T)"
      >
        <Terminal size={24} />
      </button>
    )
  }

  if (isMinimized) {
    return (
      <div className="chat-terminal-minimized" onClick={() => setIsMinimized(false)}>
        <Terminal size={18} />
        <span>Lead Terminal</span>
      </div>
    )
  }

  return (
    <div className="chat-terminal">
      <div className="chat-terminal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Terminal size={18} />
          <span>Lead Terminal</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setIsMinimized(true)} className="chat-terminal-btn">
            <Minimize2 size={16} />
          </button>
          <button onClick={() => setIsOpen(false)} className="chat-terminal-btn">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="chat-terminal-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message chat-message-${msg.type}`}>
            {msg.text}
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message-system">
            <span className="typing-indicator">●●●</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-terminal-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="add john smith from acme capital..."
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading || !input.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  )
}

export default ChatTerminal
