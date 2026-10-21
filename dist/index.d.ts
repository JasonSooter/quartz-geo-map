import { QuartzTransformerPlugin, QuartzPageTypePlugin } from '@quartz-community/types';

declare const mapViewRegistration: {
    id: string;
    name: string;
    icon: string;
    render: (props: unknown) => unknown;
    css: string;
    afterDOMLoaded: string;
};

/** A work that mentions a place, from the note's "At a glance" table. */
interface GeoSource {
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
interface RawGeoSource extends Omit<GeoSource, "url"> {
    /** Wikilink target when the source cell was `[[Target|Alias]]`. */
    target?: string;
}
/** An inline `[label](geo:lat,lng) #place/type` reference found in a note body. */
interface InlineGeo {
    label: string;
    lat: number;
    lng: number;
    /** The trailing tag without the leading '#', e.g. "place/landmark". */
    tag?: string;
}

declare const GeoLinks: QuartzTransformerPlugin;
declare module "vfile" {
    interface DataMap {
        geoLinks: InlineGeo[];
        geoSummary: string;
        geoSources: RawGeoSource[];
    }
}

interface GeoMapPageOptions {
    /** Link resolution strategy; should match crawl-links. Default "shortest". */
    linkResolution?: "absolute" | "relative" | "shortest";
}
/**
 * Page type that generates a single virtual `/map` page aggregating every
 * geolocated note in the vault — both note-level pins and inline geo mentions.
 */
declare const GeoMapPage: QuartzPageTypePlugin<GeoMapPageOptions>;

export { GeoLinks, GeoMapPage, mapViewRegistration };
