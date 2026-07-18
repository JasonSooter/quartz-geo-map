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
import { parseCoords, tagToIcon, type GeoMarker, type InlineGeo } from "./markers";

/** URL slug of the aggregated map page. */
const SLUG = "map";

interface GeoMapPageOptions {
  /** Link resolution strategy; should match crawl-links. Default "shortest". */
  linkResolution?: "absolute" | "relative" | "shortest";
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
  for (const file of allFiles) {
    const slug = file.slug as FullSlug | undefined;
    if (!slug) continue;
    const fm = (file.frontmatter ?? {}) as Record<string, unknown>;
    const url = transformLink(pageSlug, slug, { strategy: linkResolution, allSlugs });
    const title =
      typeof fm.title === "string" && fm.title.length > 0 ? fm.title : file.slug || "Untitled";

    // 1. note-level coordinates
    const coords = parseCoords(fm.coordinates);
    if (coords) {
      markers.push({
        title,
        url,
        lat: coords[0],
        lng: coords[1],
        color: typeof fm.color === "string" ? fm.color : undefined,
        flag: typeof fm.flag === "string" ? fm.flag : undefined,
        icon: typeof fm.icon === "string" ? fm.icon : undefined,
      });
    }

    // 2. inline geo links
    const links = (file.geoLinks ?? []) as InlineGeo[];
    for (const g of links) {
      markers.push({
        title: g.label || title,
        url,
        lat: g.lat,
        lng: g.lng,
        icon: tagToIcon(g.tag),
      });
    }
  }
  return markers;
}

const GeoMapBody: QuartzComponentConstructor = () => {
  const Body: QuartzComponent = ({ fileData, allFiles, cfg }: QuartzComponentProps) => {
    const pageSlug = (fileData.slug ?? SLUG) as FullSlug;
    const allSlugs = allFiles
      .map((f) => f.slug)
      .filter((s): s is FullSlug => typeof s === "string");
    const linkResolution =
      (cfg as { geoMapLinkResolution?: "absolute" | "relative" | "shortest" })
        .geoMapLinkResolution ?? "shortest";
    const markers = collectMarkers(allFiles, pageSlug, allSlugs, linkResolution);

    return (
      <div class="geo-map-wrapper">
        {markers.length === 0 ? (
          <div class="geo-map-empty">
            No geolocated notes yet — add a <code>coordinates</code> property or an inline{" "}
            <code>[name](geo:lat,lng)</code> link.
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
export const GeoMapPage: QuartzPageTypePlugin<GeoMapPageOptions> = () => ({
  name: "GeoMapPage",
  priority: 20,
  match: ({ fileData }) => "isGeoMapPage" in fileData,
  generate(): VirtualPage[] {
    return [
      {
        slug: SLUG as FullSlug,
        title: "Map",
        data: {
          frontmatter: { title: "Map", tags: [] },
          isGeoMapPage: true,
        },
      },
    ];
  },
  layout: "content",
  body: GeoMapBody,
});
