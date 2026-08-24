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

export * from './api/cache'
export * from './api/leads'
export * from './api/outreach'
export * from './api/queue'
export * from './api/demos'
export * from './api/investors'
export * from './api/partners'
export * from './api/sellers'
export * from './api/today'
export * from './api/followups'
export * from './api/movement'
export * from './api/misc'
