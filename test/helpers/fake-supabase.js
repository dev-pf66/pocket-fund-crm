/**
 * A recording stand-in for the supabase-js client.
 *
 * Not a query engine — it does not filter or sort anything. It records every
 * chained call as a structured operation and hands that operation to a
 * responder function the test supplies, which returns the canned
 * `{ data, error }`. That is enough to assert the things that actually matter
 * about this codebase's trap-prone paths: WHICH table was written, with WHAT
 * payload, and whether a write happened at all.
 *
 *   const db = fakeSupabase(op => {
 *     if (op.table === 'crm_leads' && op.type === 'select') return { data: lead }
 *     return { data: [] }
 *   })
 *   db.ops  // every operation, in order
 */

// Every builder method the app chains, all of which return the builder.
const CHAINABLE = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'or', 'contains', 'ilike',
  'order', 'range', 'limit', 'single', 'maybeSingle'
]

// Methods that establish what kind of operation this is.
const MUTATIONS = { insert: 'insert', update: 'update', upsert: 'upsert', delete: 'delete' }

export function fakeSupabase(responder = () => ({ data: null, error: null })) {
  const ops = []

  function from(table) {
    const op = {
      table,
      type: 'select',      // overwritten by insert/update/upsert/delete
      payload: undefined,  // the row(s) passed to a mutation
      filters: [],         // [['eq', 'id', 42], ...]
      calls: [],           // every method name, in order
      single: false,
      range: null,
      limit: null
    }
    ops.push(op)

    const builder = {}
    for (const method of CHAINABLE) {
      builder[method] = (...args) => {
        op.calls.push(method)
        if (MUTATIONS[method]) {
          op.type = MUTATIONS[method]
          op.payload = args[0]
        } else if (method === 'single' || method === 'maybeSingle') {
          op.single = true
        } else if (method === 'range') {
          op.range = [args[0], args[1]]
        } else if (method === 'limit') {
          op.limit = args[0]
        } else if (method !== 'select' && method !== 'order') {
          op.filters.push([method, ...args])
        }
        return builder
      }
    }

    // Thenable: awaiting the builder resolves the canned response. Resolved
    // lazily so the responder sees the fully-chained operation.
    builder.then = (onFulfilled, onRejected) => {
      let result
      try {
        result = responder(op) ?? { data: null, error: null }
      } catch (e) {
        return Promise.reject(e).then(onFulfilled, onRejected)
      }
      if (result.error === undefined) result = { ...result, error: null }
      if (result.data === undefined) result = { ...result, data: null }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    }

    return builder
  }

  return {
    from,
    ops,
    /** Operations against one table, optionally narrowed to one type. */
    opsFor(table, type) {
      return ops.filter(o => o.table === table && (!type || o.type === type))
    },
    auth: {
      getSession: async () => ({ data: { session: null } })
    }
  }
}
