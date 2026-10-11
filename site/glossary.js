// The site's glossary: every term the pages use, defined in the specification's own words, loaded from
// site/glossary.json beside this module. Each page's component imports this module when it mounts and renders the
// glossary panel and its prerequisite strip from what it returns.

/** The entries, with an index by id. */
export function index(entries) {
  const byId = new Map(entries.map(e => [e.id, e]));
  for (const e of entries) for (const id of e.related ?? []) if (!byId.has(id)) throw new Error(`${e.id} relates to ${id}, which the glossary lacks`);
  return { entries, byId };
}

/** Loads site/glossary.json relative to this module. */
export async function load(fetchFn = globalThis.fetch) {
  const response = await fetchFn(new URL('./glossary.json', import.meta.url));
  if (!response.ok) throw new Error(`glossary.json: HTTP ${response.status}`);
  return index(await response.json());
}

const text = e => [e.term, ...(e.aliases ?? []), e.id.replace(/-/g, ' '), e.plain, e.spec ?? ''].join(' ').toLowerCase();

/**
 * The entries a query matches, every word of it, in the term, an alias, the plain definition or the spec's sentence.
 * Entries whose term starts with the query come first, then those whose term contains it, then the rest, each group
 * in the glossary's own order. An empty query returns every entry.
 */
export function search(entries, query) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return entries;
  const words = q.split(/\s+/);
  const rank = e => { const t = e.term.toLowerCase(); return t.startsWith(q) ? 0 : t.includes(q) ? 1 : 2; };
  return entries.filter(e => { const hay = text(e); return words.every(w => hay.includes(w)); })
    .map((e, i) => [rank(e), i, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(r => r[2]);
}

/** The link to where the site defines an entry's term. */
export const whereHref = e => e.where ? `./${e.where.page}${e.where.anchor ? '#' + e.where.anchor : ''}` : '';
