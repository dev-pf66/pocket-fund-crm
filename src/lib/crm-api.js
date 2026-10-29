/**
 * CRM API - Sales lead management for Pocket Fund
 *
 * Pure barrel: the implementation lives in ./api/*. Each module below
 * exports exactly the names that were public on the original monolithic
 * crm-api.js, so this file's export surface is unchanged. Shared internals
 * (cacheGet/cacheSet, fireTTEvent, istDateStr, getDaysBetween) live in
 * ./api/core, which is deliberately NOT re-exported here — modules import
 * from it directly; only cacheClear/cachePeek are public (via ./api/cache).
 */

export * from './api/cache.js'
export * from './api/leads.js'
export * from './api/outreach.js'
export * from './api/queue.js'
export * from './api/demos.js'
export * from './api/investors.js'
export * from './api/partners.js'
export * from './api/sellers.js'
export * from './api/italy-pipeline.js'
export * from './api/today.js'
export * from './api/followups.js'
export * from './api/cover.js'
export * from './api/notifications.js'
export * from './api/archive.js'
export * from './api/movement.js'
export * from './api/scoreboard.js'
export * from './api/calls.js'
export * from './api/misc.js'
