/**
 * Shared fan-out helper for bulk-edit action bars (Today tab, pipeline
 * boards). Runs `fn` per item with Promise.allSettled so one bad item
 * (stale cache, RLS edge case) doesn't sink the whole batch — callers get
 * back which ids actually went through and which failed.
 */
export async function runBulk(items, fn) {
  const results = await Promise.allSettled(items.map(item => fn(item)))
  const succeeded = []
  const failed = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') succeeded.push(items[i].id)
    else failed.push({ id: items[i].id, error: r.reason })
  })
  return { succeeded, failed }
}
