import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../App'
import { ArrowLeft, Plus, Edit2, Trash2, Save, X } from 'lucide-react'
import { useToast } from '../components/Toast'

const CATEGORIES = [
  { value: 'getting_started', label: '🚀 Getting Started' },
  { value: 'leads', label: '👤 Lead Management' },
  { value: 'outreach', label: '📧 Outreach Tracking' },
  { value: 'team', label: '👥 Team Features' },
  { value: 'analytics', label: '📊 Analytics' }
]

function HelpAdmin() {
  const navigate = useNavigate()
  const { currentPerson } = useApp()
  const { toast } = useToast()
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingArticle, setEditingArticle] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const [formData, setFormData] = useState({
    title: '',
    category: 'getting_started',
    content: '',
    order_index: 0,
    is_published: true
  })

  useEffect(() => {
    loadArticles()
  }, [])

  async function loadArticles() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('crm_help_articles')
        .select('*')
        .order('category')
        .order('order_index')

      if (error) throw error
      setArticles(data || [])
    } catch (error) {
      console.error('Failed to load articles:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleEdit(article) {
    setEditingArticle(article.id)
    setFormData({
      title: article.title,
      category: article.category,
      content: article.content,
      order_index: article.order_index,
      is_published: article.is_published
    })
    setShowForm(true)
  }

  function handleNew() {
    setEditingArticle(null)
    setFormData({
      title: '',
      category: 'getting_started',
      content: '',
      order_index: 0,
      is_published: true
    })
    setShowForm(true)
  }

  function handleCancel() {
    setShowForm(false)
    setEditingArticle(null)
    setFormData({
      title: '',
      category: 'getting_started',
      content: '',
      order_index: 0,
      is_published: true
    })
  }

  async function handleSave() {
    if (!formData.title || !formData.content) {
      toast.warn('Please fill in title and content')
      return
    }

    try {
      if (editingArticle) {
        // Update existing
        const { error } = await supabase
          .from('crm_help_articles')
          .update({
            ...formData,
            last_updated_by: currentPerson?.id,
            version: supabase.raw('version + 1')
          })
          .eq('id', editingArticle)

        if (error) throw error
      } else {
        // Create new
        const { error } = await supabase
          .from('crm_help_articles')
          .insert([{
            ...formData,
            last_updated_by: currentPerson?.id
          }])

        if (error) throw error
      }

      await loadArticles()
      handleCancel()
    } catch (error) {
      console.error('Failed to save article:', error)
      toast.error('Failed to save article: ' + error.message)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this article? This cannot be undone.')) return

    try {
      const { error } = await supabase
        .from('crm_help_articles')
        .delete()
        .eq('id', id)

      if (error) throw error
      await loadArticles()
    } catch (error) {
      console.error('Failed to delete article:', error)
      toast.error('Failed to delete article')
    }
  }

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/help')}>
            <ArrowLeft size={18} />
          </button>
          <h1>Edit Help Articles</h1>
        </div>
        <button className="btn btn-primary" onClick={handleNew}>
          <Plus size={18} />
          New Article
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '24px', borderColor: 'var(--primary)' }}>
          <h2>{editingArticle ? 'Edit Article' : 'New Article'}</h2>

          <div className="form-grid">
            <div className="form-group">
              <label>Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., How to Add Leads"
              />
            </div>

            <div className="form-group">
              <label>Category *</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Order Index</label>
              <input
                type="number"
                value={formData.order_index}
                onChange={(e) => setFormData({ ...formData, order_index: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
              <small style={{ color: 'var(--gray-600)', display: 'block', marginTop: '4px' }}>
                Lower numbers appear first within category
              </small>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.is_published}
                  onChange={(e) => setFormData({ ...formData, is_published: e.target.checked })}
                />
                {' '}Published (visible to users)
              </label>
            </div>

            <div className="form-group full-width">
              <label>Content * (supports markdown)</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={15}
                placeholder="Write your help content here...

Supports markdown:
# Header 1
## Header 2
### Header 3

**bold text**

- Bullet point
✅ Checklist item

```
code block
```"
                style={{ fontFamily: 'monospace', fontSize: '14px' }}
              />
              <small style={{ color: 'var(--gray-600)', display: 'block', marginTop: '8px' }}>
                Use # for headers, ** for bold, - for lists, ``` for code blocks
              </small>
            </div>

            <div className="form-group full-width" style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={18} />
                Save Article
              </button>
              <button className="btn btn-secondary" onClick={handleCancel}>
                <X size={18} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Articles List */}
      <div className="card">
        <h2>All Articles ({articles.length})</h2>

        {articles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--gray-500)' }}>
            No articles yet. Click "New Article" to create one!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--gray-200)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', fontWeight: '600' }}>Title</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600' }}>Category</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600' }}>Order</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600' }}>Status</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600' }}>Updated</th>
                  <th style={{ padding: '12px 8px', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map(article => (
                  <tr key={article.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: '500' }}>{article.title}</td>
                    <td style={{ padding: '12px 8px' }}>
                      {CATEGORIES.find(c => c.value === article.category)?.label || article.category}
                    </td>
                    <td style={{ padding: '12px 8px' }}>{article.order_index}</td>
                    <td style={{ padding: '12px 8px' }}>
                      {article.is_published ? (
                        <span style={{ color: 'var(--success)', fontSize: '14px' }}>✓ Published</span>
                      ) : (
                        <span style={{ color: 'var(--gray-500)', fontSize: '14px' }}>✗ Draft</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--gray-600)' }}>
                      {new Date(article.updated_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="icon-btn"
                          onClick={() => handleEdit(article)}
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => handleDelete(article.id)}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default HelpAdmin
