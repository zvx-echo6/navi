// Wiki / Wikidata link builders.
//
// The backend (navi-places wiki_rewrite) already turns each OSM wiki tag into a
// complete URL in extratags.{wikipedia,wikidata,wikivoyage} — a local Kiwix URL
// (https://wiki.echo6.co/content/...) when the article is mirrored, otherwise the
// public URL — and records which in sources.wiki_rewrites[tag] = 'local' | 'public'.
//
// These helpers use those rewritten values verbatim instead of rebuilding URLs
// from raw tag values. Rebuilding was the source of three bugs: the Wikipedia /
// Wikivoyage links showed a "(local)" badge while pointing at the public site
// (they used the public wiki-index fields and ignored the rewritten extratags),
// and Wikidata doubled its prefix onto an already-complete URL.

// Public Wikipedia URL from a raw OSM tag value ("en:Title" or "Title").
function publicWikipediaUrl(wp) {
  if (!wp) return null
  const [lang, ...rest] = wp.split(":")
  const title = rest.join(":").replace(/ /g, "_")
  if (!title) return null
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`
}

// Public Wikivoyage URL from a raw OSM tag value ("en:Title" or "Title").
function publicWikivoyageUrl(wv) {
  if (!wv) return null
  const parts = wv.split(":")
  const title = (parts.length > 1 ? parts.slice(1).join(":") : parts[0]).replace(/ /g, "_")
  if (!title) return null
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(title)}`
}

// Resolve the Wikipedia link for a place: { href, local } or null.
// Prefers the backend-rewritten extratags.wikipedia (already a full URL); only
// falls back to the public wiki-index wiki_url when there is no OSM wikipedia tag.
export function wikipediaLink(details) {
  const et = (details && details.extratags) || {}
  const status = details && details.sources && details.sources.wiki_rewrites
    ? details.sources.wiki_rewrites.wikipedia
    : undefined
  if (et.wikipedia) {
    const href = et.wikipedia.startsWith("http")
      ? et.wikipedia
      : publicWikipediaUrl(et.wikipedia)
    return href ? { href, local: status === "local" } : null
  }
  if (details && details.wiki_url) return { href: details.wiki_url, local: false }
  return null
}

// Resolve the Wikivoyage link for a place: { href, local } or null.
export function wikivoyageLink(details) {
  const et = (details && details.extratags) || {}
  const status = details && details.sources && details.sources.wiki_rewrites
    ? details.sources.wiki_rewrites.wikivoyage
    : undefined
  if (et.wikivoyage) {
    const href = et.wikivoyage.startsWith("http")
      ? et.wikivoyage
      : publicWikivoyageUrl(et.wikivoyage)
    return href ? { href, local: status === "local" } : null
  }
  if (details && details.wikivoyage_url) return { href: details.wikivoyage_url, local: false }
  return null
}

// Resolve the Wikidata href. extratags.wikidata is already a full URL after the
// backend rewrite; only build the URL when given a bare Q-id (rewriting disabled).
export function wikidataHref(et) {
  const wd = et && et.wikidata
  if (!wd) return null
  return wd.startsWith("http") ? wd : `https://www.wikidata.org/wiki/${wd}`
}
