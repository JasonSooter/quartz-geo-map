import { QuartzTransformerPlugin, QuartzPageTypePlugin } from '@quartz-community/types';

declare const mapViewRegistration: {
    id: string;
    name: string;
    icon: string;
    render: (props: unknown) => unknown;
    css: string;
    afterDOMLoaded: string;
};

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
