// Shared marker types + helpers used by both the Bases map view (note-level
// pins) and the /map page (vault-wide inline `geo:` links).

/** One pin serialized into a container's data-geo-markers attribute. */
export interface GeoMarker {
  title: string;
  url: string;
  lat: number;
  lng: number;
  color?: string;
  /** Emoji glyph (e.g. a national flag) rendered directly as the marker. */
  flag?: string;
  /** Lucide/place-type name (e.g. "landmark", "mention"); mapped to an emoji client-side. */
  icon?: string;
  /** Coarse place type for the filter UI (country/city/state/continent/landmark/…). */
  type?: string;
  /** One- or two-sentence description shown in the marker popup. */
  summary?: string;
  /** Books/articles/videos that mention this place (capped; see `moreSources`). */
  sources?: GeoSource[];
  /** How many further sources exist beyond `sources`. */
  moreSources?: number;
  /** What kind of work mentions it: book/article/video/podcast, else "travel". */
  medium?: string;
  /** Canonical roles across all sources (subject/setting/journey/turning point/backdrop/other). */
  roles?: string[];
  /** Titles of every source (uncapped), for the "From:" filter. */
  from?: string[];
}

/** A work that mentions a place, from the note's "At a glance" table. */
export interface GeoSource {
  title: string;
  /** Resolved link to the source's note, when it is a published `[[wikilink]]`. */
  url?: string;
  /** The original work online (article, video…), from its section's `[Original](…)` link. */
  external?: string;
  author?: string;
  /** How the place figures in the work, e.g. "setting" or "subject". */
  role?: string;
  /** One-line summary of the place's part in the work. */
  line?: string;
}

/** A source as parsed from markdown, before its wikilink is resolved to a URL. */
export interface RawGeoSource extends Omit<GeoSource, "url"> {
  /** Wikilink target when the source cell was `[[Target|Alias]]`. */
  target?: string;
}

/**
 * Derive a coarse place-type (used by the /map filter chips) from a marker's
 * flag/icon. Countries carry a flag; note-level pins use Lucide icons; inline
 * markers use the `#place/<type>` tag (already resolved into `icon`).
 */
export function markerType(m: { icon?: string; flag?: string }): string {
  if (m.flag) return "country";
  switch (m.icon) {
    case "landmark":
      return "landmark";
    case "building-2":
      return "city";
    case "map":
      return "state";
    case "globe":
      return "continent";
    case "museum":
    case "park":
    case "coworking":
    case "mention":
      return m.icon;
    // Places found in reading: books, articles, podcasts, videos.
    case "book":
    case "newspaper":
    case "podcast":
    case "video":
      return "literary";
    default:
      return "place";
  }
}

/**
 * The /map medium filter: places found in reading carry the source's icon
 * (book/newspaper/video/podcast); everything else is a travel place.
 */
export function markerMedium(icon: string | undefined): string {
  switch (icon) {
    case "book":
    case "mention":
      return "book";
    case "newspaper":
      return "article";
    case "video":
      return "video";
    case "podcast":
      return "podcast";
    default:
      return "travel";
  }
}

/** Fold free-text roles ("journey waypoint", "setting / subject") into filter buckets. */
export function canonicalRoles(raw: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    for (const part of (r ?? "").toLowerCase().split(/[/,;]/)) {
      const t = part.trim();
      if (!t) continue;
      if (t.includes("waypoint") || t.includes("journey")) out.add("journey");
      else if (t.includes("turning")) out.add("turning point");
      else if (t.includes("subject")) out.add("subject");
      else if (t.includes("setting")) out.add("setting");
      else if (t.includes("backdrop")) out.add("backdrop");
      else out.add("other");
    }
  }
  return [...out];
}

/** An inline `[label](geo:lat,lng) #place/type` reference found in a note body. */
export interface InlineGeo {
  label: string;
  lat: number;
  lng: number;
  /** The trailing tag without the leading '#', e.g. "place/landmark". */
  tag?: string;
}

/** Parse a "lat,lng" string into a tuple, tolerant of surrounding whitespace. */
export function parseCoords(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1]];
}

/**
 * A note's pin: the Map View plugin's `coordinates: "lat,lng"`, else the
 * `location: [lat, lng]` list that Obsidian Bases' map view uses (also accepted
 * as a "lat,lng" string).
 */
export function noteCoords(
  props: Record<string, unknown>,
): [number, number] | null {
  const fromCoordinates = parseCoords(props.coordinates);
  if (fromCoordinates) return fromCoordinates;
  const loc = props.location;
  if (Array.isArray(loc) && loc.length === 2) {
    const [lat, lng] = loc.map((n) => Number(n));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    return null;
  }
  return parseCoords(loc);
}

// [label](geo:LAT,LNG) optionally followed by a #place/type tag.
const GEO_RE =
  /\[([^\]]*)\]\(geo:(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)(?:\s*#([\w/-]+))?/g;

/** Extract every inline geo reference from a raw markdown string. */
export function extractInlineGeo(raw: string): InlineGeo[] {
  const out: InlineGeo[] = [];
  GEO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GEO_RE.exec(raw)) !== null) {
    out.push({
      label: m[1] || "",
      lat: Number(m[2]),
      lng: Number(m[3]),
      tag: m[4],
    });
  }
  return out;
}

/** A place-type tag ("place/landmark") → the icon key the client maps to an emoji. */
export function tagToIcon(tag: string | undefined): string {
  if (!tag) return "mention";
  return tag.replace(/^place\//, "");
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** Flatten markdown inline syntax (wikilinks, links, emphasis) to plain text. */
export function plainText(md: string): string {
  return md
    .replace(WIKILINK_RE, (_m, target: string, alias?: string) =>
      (alias ?? target).trim(),
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip YAML frontmatter from a raw markdown string. */
function body(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

/**
 * The note's first prose paragraph (skipping headings, tables, quotes, lists and
 * callouts), flattened to plain text — a short summary for the marker popup.
 */
export function extractSummary(raw: string, maxLen = 220): string | undefined {
  for (const block of body(raw).split(/\r?\n\s*\r?\n/)) {
    const text = block.trim();
    if (!text || /^(#|\||>|[-*+] |\d+\. |!\[|```|<)/.test(text)) continue;
    const flat = plainText(text);
    if (!flat) continue;
    return flat.length > maxLen
      ? `${flat.slice(0, maxLen - 1).trimEnd()}…`
      : flat;
  }
  return undefined;
}

/**
 * Rows of an "At a glance" table (`| Source | Author | Role | In one line |`):
 * the works that mention this place. Columns are matched by header name, so
 * order and extra columns don't matter; only Source is required.
 */
export function extractSources(raw: string): RawGeoSource[] {
  const m = body(raw).match(
    /^##+\s*At a glance\s*\r?\n+((?:\|.*(?:\r?\n|$))+)/im,
  );
  if (!m) return [];
  const rows = m[1]
    .split(/\r?\n/)
    .filter((r) => r.trim().startsWith("|"))
    // Split on unescaped pipes; a `\|` inside a wikilink alias stays put.
    .map((r) =>
      r
        .trim()
        .replace(/^\||\|$/g, "")
        .split(/(?<!\\)\|/)
        .map((c) => c.trim()),
    );
  if (rows.length < 3) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iSource = col("source");
  if (iSource < 0) return [];
  const iAuthor = col("author");
  const iRole = col("role");
  const iLine = col("line");
  const originals = originalLinks(raw);
  const out: RawGeoSource[] = [];
  for (const cells of rows.slice(2)) {
    const cell = (cells[iSource] ?? "").replace(/\\\|/g, "|");
    const title = plainText(cell);
    if (!title) continue;
    WIKILINK_RE.lastIndex = 0;
    const link = WIKILINK_RE.exec(cell);
    const get = (i: number) =>
      i >= 0 && cells[i] ? plainText(cells[i]) : undefined;
    out.push({
      title,
      target: link ? link[1].trim() : undefined,
      author: get(iAuthor),
      role: get(iRole),
      line: get(iLine),
      external: originals.get(title.toLowerCase()),
    });
  }
  return out;
}

/**
 * Per-source sections (`## Title — Author` … `[Original](https://…)`): map each
 * lowercased title to its original URL, so unlinked sources still get a link.
 */
function originalLinks(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of body(raw)
    .split(/^##\s+/m)
    .slice(1)) {
    const heading = section
      .slice(0, section.indexOf("\n"))
      .split(/\s+[—–]\s+/)[0];
    const url = section.match(/\[Original\]\((https?:\/\/[^)\s]+)\)/)?.[1];
    if (heading && url) out.set(plainText(heading).toLowerCase(), url);
  }
  return out;
}
