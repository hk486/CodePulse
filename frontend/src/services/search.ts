/**
 * One way to search.
 *
 * The global search, the projects filter and the reports filter all look
 * for the same things: a name, a description, a language. Keeping them in
 * one place means typing "go" finds the Go project wherever you happen to
 * be standing.
 */
export function matches(haystack: (string | undefined | null)[], term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return haystack.some(part => (part || '').toLowerCase().includes(needle))
}
