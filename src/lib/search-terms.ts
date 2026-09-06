/**
 * Search-box parsing helpers.
 *
 * Kept separate from `actions.ts` so they can be unit-tested without
 * constructing the Supabase client, which requires environment variables at
 * import time.
 */

/**
 * Split a search box's contents into keywords. Whitespace separates terms,
 * and a "quoted phrase" is kept intact so a value like "22uF X6S" can still
 * be searched as one unit.
 *
 * Callers AND the returned terms, so each keyword may match a different
 * column: "0603 100n" finds a 100nF part whose package field says 0603.
 */
export function parseSearchTerms(search: string): string[] {
  return (search.match(/"[^"]*"|\S+/g) || [])
    .map((t) => t.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

/**
 * Escape a term for use inside a PostgREST `or=(...)` filter.
 *
 * The term is interpolated into that mini-language, where a comma separates
 * conditions and parentheses group them, so an unescaped `,` or `)` in the
 * search box silently produces a malformed query rather than a match.
 * Wrapping the pattern in double quotes makes those characters literal;
 * backslashes and embedded double quotes are escaped so the wrapper cannot
 * be broken out of.
 *
 * `%` and `_` deliberately keep their `ilike` wildcard meaning — a search
 * box that supports them is more useful than one that does not.
 */
export function escapeOrTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
