// geo-map: an interactive map for Quartz.
//
// Two capabilities from one plugin:
//  1. A Bases "map" view type (component side-effect) — one pin per note from a
//     `coordinates` frontmatter property. Registered on import (see mapView).
//  2. A vault-wide `/map` page (transformer + pageType) that aggregates inline
//     `[label](geo:lat,lng)` references from every note, plus note-level pins.
export { mapViewRegistration } from "./mapView";
export { GeoLinks } from "./geoTransformer";
export { GeoMapPage } from "./geoMapPage";
