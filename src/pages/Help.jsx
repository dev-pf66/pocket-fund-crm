import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Search, BookOpen, ChevronRight, ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

const CATEGORIES = {
  getting_started: { label: 'Getting Started', icon: '🚀', color: '#3b82f6' },
  leads: { label: 'Lead Management', icon: '👤', color: '#8b5cf6' },
  outreach: { label: 'Outreach Tracking', icon: '📧', color: '#10b981' },
  team: { label: 'Team Features', icon: '👥', color: '#f59e0b' },
  analytics: { label: 'Analytics', icon: '📊', color: '#06b6d4' }
}

function Help() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [expandedArticles, setExpandedArticles] = useState({})
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    loadArticles()
  }, [])

  async function loadArticles() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('crm_help_articles')
        .select('*')
        .eq('is_published', true)
        .order('category')
        .order('order_index')

      if (error) throw error
      setArticles(data || [])

      // Get last updated timestamp
      const { data: timestamp } = await supabase.rpc('get_help_last_updated')
      setLastUpdated(timestamp)

    } catch (error) {
      console.error('Failed to load help:', error)
      setArticles([])
    } finally {
      setLoading(false)
    }
  }

  function toggleArticle(id) {
    setExpandedArticles(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  function getFilteredArticles() {
    let filtered = articles

    // Category filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(a => a.category === selectedCategory)
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.content.toLowerCase().includes(query)
      )
    }

    return filtered
  }

  function groupByCategory(articles) {
    const grouped = {}
    articles.forEach(article => {
      if (!grouped[article.category]) {
        grouped[article.category] = []
      }
      grouped[article.category].push(article)
    })
    return grouped
  }

  const filteredArticles = getFilteredArticles()
  const groupedArticles = groupByCategory(filteredArticles)

  if (loading) {
    return <div className="loading">Loading help...</div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <BookOpen size={28} />
            Help & Documentation
          </h1>
          {lastUpdated && (
            <p style={{ color: 'var(--gray-600)', margin: '8px 0 0 0', fontSize: '14px' }}>
              Last updated: {new Date(lastUpdated).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>
          )}
        </div>
        <Link to="/help/admin" className="btn btn-secondary">
          ✏️ Edit Help
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="search-box" style={{ marginBottom: '16px' }}>
          <Search size={18} />
          <input
            type="text"
            placeholder="Search help articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="clear-search"
              onClick={() => setSearchQuery('')}
            >
              ×
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`filter-chip ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            All Topics
          </button>
          {Object.entries(CATEGORIES).map(([key, cat]) => (
            <button
              key={key}
              className={`filter-chip ${selectedCategory === key ? 'active' : ''}`}
              onClick={() => setSelectedCategory(key)}
              style={selectedCategory === key ? { background: cat.color, color: 'white', borderColor: cat.color } : {}}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Help Articles */}
      {filteredArticles.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px', color: 'var(--gray-500)' }}>
          <Search size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <div>No help articles found</div>
          {searchQuery && (
            <div style={{ marginTop: '8px', fontSize: '14px' }}>
              Try a different search term or <button onClick={() => setSearchQuery('')} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>clear search</button>
            </div>
          )}
        </div>
      ) : (
        Object.entries(groupedArticles).map(([category, categoryArticles]) => (
          <div key={category} className="card" style={{ marginBottom: '24px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '24px' }}>{CATEGORIES[category]?.icon}</span>
              {CATEGORIES[category]?.label || category}
              <span style={{
                fontSize: '14px',
                fontWeight: 'normal',
                color: 'var(--gray-500)',
                marginLeft: 'auto'
              }}>
                {categoryArticles.length} article{categoryArticles.length !== 1 ? 's' : ''}
              </span>
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {categoryArticles.map(article => (
                <div
                  key={article.id}
                  style={{
                    border: '1px solid var(--gray-200)',
                    borderRadius: '8px',
                    overflow: 'hidden'
                  }}
                >
                  {/* Article Header */}
                  <div
                    onClick={() => toggleArticle(article.id)}
                    style={{
                      padding: '16px',
                      background: expandedArticles[article.id] ? 'var(--gray-50)' : 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'background 0.2s'
                    }}
                  >
                    {expandedArticles[article.id] ? (
                      <ChevronDown size={20} color="var(--primary)" />
                    ) : (
                      <ChevronRight size={20} color="var(--gray-400)" />
                    )}
                    <h3 style={{
                      margin: 0,
                      fontSize: '16px',
                      fontWeight: '600',
                      flex: 1
                    }}>
                      {article.title}
                    </h3>
                  </div>

                  {/* Article Content (Expanded) */}
                  {expandedArticles[article.id] && (
                    <div style={{
                      padding: '20px',
                      borderTop: '1px solid var(--gray-200)',
                      background: 'white'
                    }}>
                      <div
                        className="help-content"
                        style={{
                          lineHeight: '1.8',
                          color: 'var(--gray-700)'
                        }}
                      >
                        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                          {article.content}
                        </ReactMarkdown>
                      </div>
                      {article.updated_at && (
                        <div style={{
                          marginTop: '20px',
                          paddingTop: '12px',
                          borderTop: '1px solid var(--gray-100)',
                          fontSize: '13px',
                          color: 'var(--gray-500)'
                        }}>
                          Last updated: {new Date(article.updated_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// Note: Markdown rendering now handled by react-markdown with sanitization

export default Help
