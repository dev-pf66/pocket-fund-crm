/**
 * Public cache surface of the CRM API barrel.
 *
 * The cache implementation (plus the rest of the shared internals) lives in
 * ./core; internal modules import from there directly. Only these two names
 * were ever part of crm-api's public surface, so only these two are
 * re-exported to the barrel.
 */

export { cacheClear, cachePeek } from './core'
