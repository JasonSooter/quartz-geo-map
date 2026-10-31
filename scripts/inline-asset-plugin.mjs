// Shared esbuild plugin: used by tsup.config.ts for the published bundle and by
// scripts/preview.mjs for the standalone preview, so both build the client
// assets the same way.
import path from "node:path";

// Compiles `.scss` -> CSS string, reads `.css` -> string, and bundles
// `*.inline.ts` browser scripts (with their imports) into a minified string.
// Mirrors the loader used by @quartz-community/graph.
/** @type {import("esbuild").Plugin} */
export const inlineAssetPlugin = {
  name: "inline-asset-loader",
  setup(parentBuild) {
    const absWorkingDir = parentBuild.initialOptions.absWorkingDir ?? process.cwd();

    // Load maplibre-gl's stylesheet as a raw text string via a non-".css"
    // specifier so tsup's built-in CSS extraction never touches it (which would
    // emit a stray dist/index.css and leave the import binding empty).
    parentBuild.onResolve({ filter: /^maplibre-css-text$/ }, () => ({
      // Deliberately extension-less path so tsup's PostCSS loader (filter /\.css$/)
      // never matches; the real file is passed through pluginData.
      path: "maplibre-css-text",
      namespace: "raw-text",
      pluginData: {
        file: path.join(absWorkingDir, "node_modules/maplibre-gl/dist/maplibre-gl.css"),
      },
    }));
    parentBuild.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => {
      const fs = await import("fs");
      const css = await fs.promises.readFile(args.pluginData.file, "utf8");
      return { contents: css, loader: "text" };
    });

    parentBuild.onLoad({ filter: /\.scss$/ }, async (args) => {
      const sass = await import("sass");
      const result = sass.compile(args.path);
      return { contents: result.css, loader: "text" };
    });

    parentBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const fs = await import("fs");
      const css = await fs.promises.readFile(args.path, "utf8");
      return { contents: css, loader: "text" };
    });

    parentBuild.onLoad({ filter: /\.inline\.ts$/ }, async (args) => {
      const esbuild = await import("esbuild");
      const fs = await import("fs");
      let text = await fs.promises.readFile(args.path, "utf8");
      text = text.replace(/^export default /gm, "");
      text = text.replace(/^export /gm, "");

      const resolveDir = path.dirname(args.path);
      const sourcefile = path.relative(absWorkingDir, args.path);

      const result = await esbuild.build({
        stdin: { contents: text, loader: "ts", resolveDir, sourcefile },
        write: false,
        bundle: true,
        minify: true,
        platform: "browser",
        format: "esm",
        target: "es2020",
        sourcemap: false,
        external: ["http://*", "https://*"],
      });

      const js = result.outputFiles?.[0]?.text;
      if (!js) throw new Error(`inline-asset-loader: no JS output for ${args.path}`);
      return { contents: js, loader: "text" };
    });
  },
};
