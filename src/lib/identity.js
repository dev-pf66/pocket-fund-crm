// Who is the signed-in user, in CRM terms?
//
// people.email is the join key between a Supabase auth user and their CRM
// identity. Supabase preserves whatever casing someone typed at signup, and
// RLS's current_person_id() matches on LOWER(email) — so every lookup in the
// app has to normalise the same way the database does. When it didn't, a
// `Dev@` login looked like a brand-new person, minted a duplicate people row,
// and the UI and the DB then disagreed about who you were.
//
// Kept as pure functions so this rule is testable and lives in exactly one place.

/** Canonical form of an email for identity comparison. */
export function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

/**
 * Find a person by email, case- and whitespace-insensitively.
 * Returns undefined when there is no match.
 */
export function findPersonByEmail(people, email) {
  const wanted = normaliseEmail(email)
  if (!wanted) return undefined
  return (people || []).find(p => normaliseEmail(p?.email) === wanted)
}
