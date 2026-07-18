// Shared client assets (MapLibre CSS + the lazy map shim), used by both the
// Bases map view and the /map page so they render identically.
import maplibreCss from "maplibre-css-text";
import mapStyles from "./styles/map.scss";
// @ts-expect-error - inline script imported as a bundled string by esbuild loader
import mapScript from "./map.inline.ts";

export const MAP_CSS = `${maplibreCss}\n${mapStyles}`;
export const MAP_SCRIPT = mapScript as string;
