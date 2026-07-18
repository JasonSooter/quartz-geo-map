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

// [label](geo:LAT,LNG) optionally followed by a #place/type tag.
const GEO_RE =
  /\[([^\]]*)\]\(geo:(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)(?:\s*#([\w/-]+))?/g;

/** Extract every inline geo reference from a raw markdown string. */
export function extractInlineGeo(raw: string): InlineGeo[] {
  const out: InlineGeo[] = [];
  GEO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GEO_RE.exec(raw)) !== null) {
    out.push({ label: m[1] || "", lat: Number(m[2]), lng: Number(m[3]), tag: m[4] });
  }
  return out;
}

/** A place-type tag ("place/landmark") → the icon key the client maps to an emoji. */
export function tagToIcon(tag: string | undefined): string {
  if (!tag) return "mention";
  return tag.replace(/^place\//, "");
}
