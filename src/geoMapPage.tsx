import type {
  QuartzPageTypePlugin,
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
  VirtualPage,
  FullSlug,
  QuartzPluginData,
} from "@quartz-community/types";
import { transformLink } from "@quartz-community/utils";
import { MAP_CSS, MAP_SCRIPT } from "./assets";
import {
  noteCoords,
  tagToIcon,
  markerType,
  markerMedium,
  canonicalRoles,
  type GeoMarker,
  type GeoSource,
  type InlineGeo,
  type RawGeoSource,
} from "./markers";

/** URL slug of the aggregated map page. */
const SLUG = "map";

/** Sources listed per popup; the rest are summarised as "+N more". */
const MAX_SOURCES = 3;

interface GeoMapPageOptions {
  /** Link resolution strategy; should match crawl-links. Default "shortest". */
  linkResolution?: "absolute" | "relative" | "shortest";
  /** Page title. Default "Map". */
  title?: string;
  /** Meta/link-preview description for the page. */
  description?: string;
  /**
   * Link-preview image: an absolute URL, or a path under the site's `static/`
   * folder (e.g. "map-og.jpg"). Without one, og-image falls back to its default.
   */
  socialImage?: string;
}

/**
 * Aggregate two kinds of markers across every published note:
 *  1. note-level pins from a `coordinates` frontmatter property, and
 *  2. inline `[label](geo:lat,lng) #place/type` references (from the transformer).
 */
function collectMarkers(
  allFiles: QuartzPluginData[],
  pageSlug: FullSlug,
  allSlugs: FullSlug[],
  linkResolution: "absolute" | "relative" | "shortest",
): GeoMarker[] {
  const markers: GeoMarker[] = [];
  const link = (slug: FullSlug) =>
    transformLink(pageSlug, slug, { strategy: linkResolution, allSlugs });

  // Wikilink target (title, alias or file name, case-insensitive) → slug, so a
  // source's `[[Book]]` becomes a link to that book's note.
  const bySlugName = new Map<string, FullSlug>();
  for (const file of allFiles) {
    const slug = file.slug as FullSlug | undefined;
    if (!slug) continue;
    const fm = (file.frontmatter ?? {}) as Record<string, unknown>;
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : [];
    const names = [
      fm.title,
      ...aliases,
      slug.split("/").pop()?.replace(/-/g, " "),
    ];
    for (const n of names) {
      if (typeof n === "string" && n) {
        const key = n.toLowerCase();
        if (!bySlugName.has(key)) bySlugName.set(key, slug);
      }
    }
  }
  const resolveSources = (raw: RawGeoSource[]): GeoSource[] =>
    raw.map(({ target, ...src }) => {
      const slug = target ? bySlugName.get(target.toLowerCase()) : undefined;
      return slug ? { ...src, url: link(slug) } : src;
    });

  for (const file of allFiles) {
    const slug = file.slug as FullSlug | undefined;
    if (!slug) continue;
    const fm = (file.frontmatter ?? {}) as Record<string, unknown>;
    const url = link(slug);
    const title =
      typeof fm.title === "string" && fm.title.length > 0
        ? fm.title
        : file.slug || "Untitled";
    const summary =
      typeof fm.description === "string" && fm.description
        ? fm.description
        : (file.geoSummary as string | undefined);

    // 1. note-level coordinates
    const coords = noteCoords(fm);
    if (coords) {
      const flag = typeof fm.flag === "string" ? fm.flag : undefined;
      const icon = typeof fm.icon === "string" ? fm.icon : undefined;
      markers.push({
        title,
        url,
        lat: coords[0],
        lng: coords[1],
        color: typeof fm.color === "string" ? fm.color : undefined,
        flag,
        icon,
        type: markerType({ icon, flag }),
        medium: markerMedium(icon),
        summary,
        ...capSources(
          resolveSources((file.geoSources ?? []) as RawGeoSource[]),
        ),
      });
    }

    // 2. inline geo links
    const links = (file.geoLinks ?? []) as InlineGeo[];
    for (const g of links) {
      const icon = tagToIcon(g.tag);
      markers.push({
        title: g.label || title,
        url,
        lat: g.lat,
        lng: g.lng,
        icon,
        type: markerType({ icon }),
        medium: markerMedium(icon),
        // An inline mention's source is the note it appears in.
        sources: [{ title, url, line: summary }],
        from: [title],
      });
    }
  }
  return markers;
}

function capSources(
  sources: GeoSource[],
): Pick<GeoMarker, "sources" | "moreSources" | "roles" | "from" | "by"> {
  if (!sources.length) return {};
  const extra = sources.length - MAX_SOURCES;
  const filters = {
    roles: canonicalRoles(sources.map((s) => s.role)),
    from: [...new Set(sources.map((s) => s.title))],
    by: [
      ...new Set(sources.map((s) => s.author).filter((a): a is string => !!a)),
    ],
  };
  return extra > 0
    ? { sources: sources.slice(0, MAX_SOURCES), moreSources: extra, ...filters }
    : { sources, ...filters };
}

const GeoMapBody: QuartzComponentConstructor = () => {
  const Body: QuartzComponent = ({
    fileData,
    allFiles,
    cfg,
  }: QuartzComponentProps) => {
    const pageSlug = (fileData.slug ?? SLUG) as FullSlug;
    const allSlugs = allFiles
      .map((f) => f.slug)
      .filter((s): s is FullSlug => typeof s === "string");
    const linkResolution =
      (cfg as { geoMapLinkResolution?: "absolute" | "relative" | "shortest" })
        .geoMapLinkResolution ?? "shortest";
    const markers = collectMarkers(
      allFiles,
      pageSlug,
      allSlugs,
      linkResolution,
    );

    return (
      <div class="geo-map-wrapper">
        {markers.length === 0 ? (
          <div class="geo-map-empty">
            No geolocated notes yet — add a <code>coordinates</code> property or
            an inline <code>[name](geo:lat,lng)</code> link.
          </div>
        ) : (
          <div class="geo-map" data-geo-markers={JSON.stringify(markers)} />
        )}
      </div>
    );
  };

  Body.css = MAP_CSS;
  Body.afterDOMLoaded = MAP_SCRIPT;
  return Body;
};

/**
 * Page type that generates a single virtual `/map` page aggregating every
 * geolocated note in the vault — both note-level pins and inline geo mentions.
 */
export const GeoMapPage: QuartzPageTypePlugin<GeoMapPageOptions> = (opts) => ({
  name: "GeoMapPage",
  priority: 20,
  match: ({ fileData }) => "isGeoMapPage" in fileData,
  generate(): VirtualPage[] {
    const title = opts?.title ?? "Map";
    const { description, socialImage } = opts ?? {};
    return [
      {
        slug: SLUG as FullSlug,
        title,
        data: {
          frontmatter: {
            title,
            tags: [],
            ...(description ? { description } : {}),
            ...(socialImage ? { socialImage } : {}),
          },
          ...(description ? { description } : {}),
          isGeoMapPage: true,
        },
      },
    ];
  },
  layout: "content",
  body: GeoMapBody,
});
