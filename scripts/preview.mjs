// Standalone preview: renders the map with sample markers, outside any Quartz
// site. Run `npm run preview` and open the printed URL.
//
// Every page load rebuilds the client assets from src/, so editing
// src/map.inline.ts or src/styles/map.scss only needs a browser refresh.
//
// Options (environment variables):
//   PORT=4173                     port to listen on
//   MARKERS=path/to/markers.json  use your own markers instead of the samples
//                                 (a JSON array of GeoMarker, see src/markers.ts)
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { inlineAssetPlugin } from "./inline-asset-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4173);
const markersFile = path.resolve(
  process.env.MARKERS ?? path.join(root, "preview/markers.json"),
);

// Bundle src/assets.ts the same way the published plugin does, then import the
// result to get the MAP_CSS and MAP_SCRIPT strings.
async function buildAssets() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, "src/assets.ts")],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [inlineAssetPlugin],
  });
  const code = result.outputFiles[0].text;
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  return { css: mod.MAP_CSS, script: mod.MAP_SCRIPT };
}

const escapeAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Escape `</script` so the inlined script can't end its own tag early.
const inlineScript = (s) => s.replace(/<\/script/gi, "<\\/script");

async function page() {
  const [{ css, script }, markers] = await Promise.all([
    buildAssets(),
    fs.readFile(markersFile, "utf8"),
  ]);
  JSON.parse(markers); // fail loudly on a malformed markers file
  return `<!doctype html>
<html lang="en" saved-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>quartz-geo-map preview</title>
<style>
  /* Stand-ins for the Quartz theme variables the map styles use. */
  :root {
    --light: #faf8f8; --lightgray: #e5e5e5; --gray: #b8b8b8;
    --darkgray: #4e4e4e; --dark: #2b2b2b; --secondary: #284b63;
    --highlight: rgba(143, 159, 169, 0.15);
  }
  :root[saved-theme="dark"] {
    --light: #161618; --lightgray: #393639; --gray: #646464;
    --darkgray: #d4d4d4; --dark: #ebebec; --secondary: #7b97aa;
    --highlight: rgba(143, 159, 169, 0.15);
  }
  body {
    margin: 0 auto; max-width: 1100px; padding: 1rem;
    font-family: system-ui, sans-serif;
    background: var(--light); color: var(--darkgray);
  }
  .preview-bar { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; }
  .preview-bar h1 { font-size: 1.1rem; margin: 0; flex: 1; }
  .preview-bar code { font-size: 0.8rem; color: var(--gray); }
  .preview-bar button {
    font: inherit; padding: 0.3rem 0.7rem; cursor: pointer;
    background: var(--lightgray); color: var(--dark);
    border: 1px solid var(--gray); border-radius: 6px;
  }
${css}
</style>
</head>
<body>
<div class="preview-bar">
  <h1>quartz-geo-map preview</h1>
  <code>${escapeAttr(path.relative(root, markersFile))}</code>
  <button id="theme" type="button">Toggle theme</button>
</div>
<div class="geo-map-wrapper">
  <div class="geo-map" data-geo-markers="${escapeAttr(markers)}"></div>
</div>
<script type="module">
${inlineScript(script)}
</script>
<script type="module">
  // Quartz emits "nav" once the page is ready; the map script waits for it.
  document.dispatchEvent(new CustomEvent("nav", { detail: { url: location.pathname } }));
  document.getElementById("theme").addEventListener("click", () => {
    const el = document.documentElement;
    const theme = el.getAttribute("saved-theme") === "dark" ? "light" : "dark";
    el.setAttribute("saved-theme", theme);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  });
</script>
</body>
</html>`;
}

http
  .createServer(async (req, res) => {
    if (new URL(req.url, "http://x").pathname !== "/") {
      res.writeHead(404).end();
      return;
    }
    try {
      const html = await page();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(e?.stack ?? e));
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`geo-map preview: http://localhost:${port}/`);
    console.log(`markers: ${path.relative(root, markersFile)}`);
  });
