const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Lazy-initialize so module can be loaded without env vars (e.g. for testing)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}

// Tool definitions for Claude
const TOOLS = [
  {
    name: 'add_lead',
    description: 'Add a new lead to the CRM pipeline',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: {
          type: 'string',
          description: 'Full name of the contact person'
        },
        company_name: {
          type: 'string',
          description: 'Name of the company or business'
        },
        email: {
          type: 'string',
          description: 'Contact email address (optional)'
        },
        stage: {
          type: 'string',
          enum: ['new', 'contacted', 'qualified', 'sample_sent', 'negotiating', 'won', 'lost'],
          description: 'Current pipeline stage for this lead'
        },
        notes: {
          type: 'string',
          description: 'Any additional notes about the lead (optional)'
        },
        score: {
          type: 'number',
          description: 'Lead quality score from 1 (poor fit) to 5 (excellent fit) (optional)'
        }
      },
      required: ['contact_name', 'company_name', 'stage']
    }
  },
  {
    name: 'update_lead',
    description: 'Update an existing lead\'s stage, score, notes, or assigned person',
    input_schema: {
      type: 'object',
      properties: {
        search_term: {
          type: 'string',
          description: 'Name or company to search for the lead (partial match OK)'
        },
        updates: {
          type: 'object',
          description: 'Fields to update on the lead',
          properties: {
            stage: {
              type: 'string',
              enum: ['new', 'contacted', 'qualified', 'sample_sent', 'negotiating', 'won', 'lost'],
              description: 'New pipeline stage'
            },
            score: {
              type: 'number',
              description: 'New score from 1-5'
            },
            notes: {
              type: 'string',
              description: 'New or updated notes'
            }
          }
        }
      },
      required: ['search_term', 'updates']
    }
  },
  {
    name: 'log_outreach',
    description: 'Log an outreach attempt for a lead (LinkedIn message, email, call, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        lead_search_term: {
          type: 'string',
          description: 'Name or company to find the lead (partial match OK)'
        },
        platform: {
          type: 'string',
          description: 'Platform used for outreach (LinkedIn, Email, Phone, Twitter, etc.)'
        },
        message_content: {
          type: 'string',
          description: 'Content or summary of the message sent (optional)'
        },
        fit_score: {
          type: 'number',
          description: 'Fit score from 1-5 based on this interaction (optional)'
        },
        response_received: {
          type: 'boolean',
          description: 'Whether a response was received (optional)'
        }
      },
      required: ['lead_search_term', 'platform']
    }
  },
  {
    name: 'get_leads',
    description: 'Search and retrieve leads from the CRM',
    input_schema: {
      type: 'object',
      properties: {
        search_term: {
          type: 'string',
          description: 'Name, company, or keyword to search for (optional — omit to get recent leads)'
        },
        stage: {
          type: 'string',
          enum: ['new', 'contacted', 'qualified', 'sample_sent', 'negotiating', 'won', 'lost'],
          description: 'Filter by pipeline stage (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of leads to return (default: 10, max: 25)'
        }
      },
      required: []
    }
  }
];

// Find a lead by search term (name or company)
async function findLead(searchTerm) {
  const term = `%${searchTerm}%`;
  const { data, error } = await getSupabase()
    .from('crm_leads')
    .select('*')
    .or(`contact_name.ilike.${term},company_name.ilike.${term}`)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw new Error(`Search failed: ${error.message}`);
  return data || [];
}

// Execute a tool call from Claude
async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'add_lead':
      return await addLead(toolInput);
    case 'update_lead':
      return await updateLead(toolInput);
    case 'log_outreach':
      return await logOutreach(toolInput);
    case 'get_leads':
      return await getLeads(toolInput);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

async function addLead({ contact_name, company_name, email, stage, notes, score }) {
  const leadData = {
    contact_name,
    company_name,
    stage: stage || 'new',
    ...(email && { email }),
    ...(notes && { notes }),
    ...(score && { score })
  };

  const { data, error } = await getSupabase()
    .from('crm_leads')
    .insert([leadData])
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    lead: data,
    message: `Created lead: ${contact_name} (${company_name}) → ${stage}`
  };
}

async function updateLead({ search_term, updates }) {
  // Find the lead first
  const leads = await findLead(search_term);

  if (leads.length === 0) {
    return {
      success: false,
      error: `No lead found matching "${search_term}". Please check the name or company.`
    };
  }

  if (leads.length > 1) {
    const options = leads.map(l => `• ${l.contact_name} (${l.company_name}) — ${l.stage}`).join('\n');
    return {
      success: false,
      error: `Found ${leads.length} leads matching "${search_term}". Which one did you mean?\n${options}`
    };
  }

  const lead = leads[0];

  const { data, error } = await getSupabase()
    .from('crm_leads')
    .update(updates)
    .eq('id', lead.id)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  const changes = Object.entries(updates)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return {
    success: true,
    lead: data,
    message: `Updated ${lead.contact_name} (${lead.company_name}): ${changes}`
  };
}

async function logOutreach({ lead_search_term, platform, message_content, fit_score, response_received }) {
  // Find the lead first
  const leads = await findLead(lead_search_term);

  if (leads.length === 0) {
    return {
      success: false,
      error: `No lead found matching "${lead_search_term}". Please check the name or company.`
    };
  }

  if (leads.length > 1) {
    const options = leads.map(l => `• ${l.contact_name} (${l.company_name}) — ${l.stage}`).join('\n');
    return {
      success: false,
      error: `Found ${leads.length} leads matching "${lead_search_term}". Which one?\n${options}`
    };
  }

  const lead = leads[0];

  const outreachData = {
    lead_id: lead.id,
    platform,
    ...(message_content && { message_content }),
    ...(fit_score && { fit_score }),
    ...(response_received !== undefined && { response_received })
  };

  const { data, error } = await getSupabase()
    .from('crm_outreach_log')
    .insert([outreachData])
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    outreach: data,
    lead,
    message: `Logged ${platform} outreach for ${lead.contact_name} (${lead.company_name})`
  };
}

async function getLeads({ search_term, stage, limit = 10 } = {}) {
  let query = getSupabase()
    .from('crm_leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 25));

  if (search_term) {
    const term = `%${search_term}%`;
    query = query.or(`contact_name.ilike.${term},company_name.ilike.${term}`);
  }

  if (stage) {
    query = query.eq('stage', stage);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    leads: data || [],
    count: (data || []).length
  };
}

module.exports = { TOOLS, executeTool };
