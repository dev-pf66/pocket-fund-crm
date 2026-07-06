// Bootstrap admin fallback: treats this email as admin even before the
// is_admin column is seeded on person records, so the app is never locked out.
export const BOOTSTRAP_ADMIN_EMAIL = 'dev@pocket-fund.com'

export function isAdminUser(person) {
  if (!person) return false
  return Boolean(person.is_admin) || person.email === BOOTSTRAP_ADMIN_EMAIL
}
