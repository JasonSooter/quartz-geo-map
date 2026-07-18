import type { QuartzTransformerPlugin } from "@quartz-community/types";
import { extractInlineGeo, type InlineGeo } from "./markers";

// Transformer: scans each note's raw markdown for inline `[label](geo:lat,lng)`
// references and stashes them on `file.data.geoLinks`. The /map page then
// aggregates these across every note. Reading `file.value` (the raw source)
// keeps the trailing `#place/type` tag intact regardless of other transformers.
export const GeoLinks: QuartzTransformerPlugin = () => ({
  name: "GeoLinks",
  markdownPlugins() {
    return [
      () =>
        (_tree: unknown, file: { value?: unknown; data: Record<string, unknown> }) => {
          const raw = typeof file.value === "string" ? file.value : String(file.value ?? "");
          const found = extractInlineGeo(raw);
          if (found.length) file.data.geoLinks = found;
        },
    ];
  },
});

declare module "vfile" {
  interface DataMap {
    geoLinks: InlineGeo[];
  }
}
