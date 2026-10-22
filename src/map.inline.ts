// Lazy client shim. Compiles to a tiny script that ships in Quartz's shared
// postscript, but the heavy MapLibre GL library is only fetched on demand — the
// first time a page actually contains a `.geo-map` element. MapLibre renders
// OpenStreetMap vector tiles (via OpenFreeMap) so streets stay crisp at every
// zoom. MapLibre's CSS is injected separately (page-scoped) via the view's `css`.

// MapLibre 5+ ships only as ES modules (no UMD global), so it is loaded with a
// dynamic import. Keep this version in step with the maplibre-gl devDependency,
// whose CSS is bundled in assets.ts.
const MAPLIBRE_JS =
  "https://cdn.jsdelivr.net/npm/maplibre-gl@6.14.0/dist/maplibre-gl.mjs";

// OpenFreeMap styles — all rendered from OpenStreetMap data, keyless.
// Swap these two constants to change the basemap look.
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/fiord";

type MapLibre = typeof import("maplibre-gl");
type MLMap = InstanceType<MapLibre["Map"]>;

interface MapLibreWindow {
  maplibregl?: MapLibre;
  __geoThemeHook?: boolean;
}

let libPromise: Promise<MapLibre> | null = null;
function loadMapLibre(): Promise<MapLibre> {
  const w = window as unknown as MapLibreWindow;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (!libPromise) {
    libPromise = (
      import(/* @vite-ignore */ MAPLIBRE_JS) as Promise<
        MapLibre & { default?: MapLibre }
      >
    )
      .then((mod) => {
        const lib = mod.default ?? mod;
        w.maplibregl = lib;
        return lib;
      })
      .catch((err) => {
        libPromise = null;
        throw new Error(`geo-map: failed to load MapLibre GL (${err})`);
      });
  }
  return libPromise;
}

interface GeoMarker {
  title: string;
  url: string;
  lat: number;
  lng: number;
  color?: string;
  flag?: string;
  icon?: string;
  /** Coarse place type (country/city/landmark/literary/…). */
  type?: string;
  summary?: string;
  sources?: GeoSource[];
  moreSources?: number;
  /** book/article/video/podcast/travel — the medium filter. */
  medium?: string;
  /** Canonical roles across all sources — the role filter. */
  roles?: string[];
  /** Every source title (uncapped) — the "From:" filter. */
  from?: string[];
}

interface GeoSource {
  title: string;
  url?: string;
  external?: string;
  author?: string;
  role?: string;
  line?: string;
}

// Filter chips: label + dot colour (Nord), in display order. The colour is also
// the point colour on the map, so the chips double as the legend.
const MEDIA: { key: string; label: string; color: string }[] = [
  { key: "book", label: "Books", color: "#ebcb8b" },
  { key: "article", label: "Articles", color: "#88c0d0" },
  { key: "video", label: "Videos", color: "#bf616a" },
  { key: "podcast", label: "Podcasts", color: "#b48ead" },
  { key: "travel", label: "Travel", color: "#a3be8c" },
];
const ROLES: { key: string; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "setting", label: "Setting" },
  { key: "journey", label: "Journey" },
  { key: "turning point", label: "Turning point" },
  { key: "backdrop", label: "Backdrop" },
  { key: "other", label: "Other" },
];
const CLUSTER_COLOR = "#5e81ac";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

function isDark(): boolean {
  return document.documentElement.getAttribute("saved-theme") === "dark";
}

function styleUrl(dark: boolean = isDark()): string {
  return dark ? STYLE_DARK : STYLE_LIGHT;
}

function link(url: string | undefined, text: string): string {
  return url
    ? `<a href="${escapeHtml(url)}" class="internal">${escapeHtml(text)}</a>`
    : escapeHtml(text);
}

// A source links to its note when it has one, else to the original work online.
function sourceLink(s: GeoSource): string {
  if (s.url || !s.external) return link(s.url, s.title);
  return (
    `<a href="${escapeHtml(s.external)}" class="external" target="_blank" rel="noopener noreferrer">` +
    `${escapeHtml(s.title)} ↗</a>`
  );
}

// Popup body: place name, short summary, then the works that mention it.
function popupHtml(m: GeoMarker): string {
  let html = `<div class="geo-popup-title">${link(m.url, m.title)}</div>`;
  if (m.summary)
    html += `<p class="geo-popup-summary">${escapeHtml(m.summary)}</p>`;
  if (m.sources?.length) {
    html += `<ul class="geo-popup-sources">`;
    for (const s of m.sources) {
      const meta = [s.author, s.role]
        .filter(Boolean)
        .map((t) => escapeHtml(t as string));
      html +=
        `<li><span class="geo-popup-source">${sourceLink(s)}</span>` +
        (meta.length
          ? ` <span class="geo-popup-meta">${meta.join(" · ")}</span>`
          : "") +
        (s.line && s.line !== m.summary
          ? `<span class="geo-popup-line">${escapeHtml(s.line)}</span>`
          : "") +
        `</li>`;
    }
    html += `</ul>`;
    if (m.moreSources) {
      html += `<div class="geo-popup-more">${link(m.url, `+${m.moreSources} more →`)}</div>`;
    }
  }
  return html;
}

function mediumOf(m: GeoMarker): string {
  return m.medium || (m.type === "literary" ? "book" : "travel");
}

/** Everything the filters need, computed once per marker. */
interface Indexed {
  m: GeoMarker;
  medium: string;
  roles: string[];
  /** Lowercased source titles, for the exact "From:" match. */
  from: string[];
  /** Lowercased title + source titles + authors, for the search box. */
  haystack: string;
}

interface FilterState {
  media: Set<string>;
  roles: Set<string>;
  query: string;
  /** Lowercased source title, or "" for any. */
  from: string;
}

function matches(x: Indexed, f: FilterState): boolean {
  if (!f.media.has(x.medium)) return false;
  // Places with no recorded role (travel places, inline mentions) ignore the role filter.
  if (x.roles.length && !x.roles.some((r) => f.roles.has(r))) return false;
  if (f.from && !x.from.includes(f.from)) return false;
  if (f.query && !x.haystack.includes(f.query)) return false;
  return true;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Filter bar above the map: search, a "From:" source picker, medium and role
// chips, and a live count. Every change calls `onChange`; the map re-renders
// its clustered source from the matching markers.
function buildFilterBar(
  wrapper: HTMLElement,
  container: HTMLElement,
  items: Indexed[],
  state: FilterState,
  onChange: (refit: boolean) => void,
): (shown: number) => void {
  const bar = el("div", "geo-filter");

  const row = el("div", "geo-filter-row");
  const search = el("input", "geo-search");
  search.type = "search";
  search.placeholder = "Search places, books, authors…";
  search.setAttribute("aria-label", "Search places, books and authors");
  search.addEventListener("input", () => {
    state.query = search.value.trim().toLowerCase();
    onChange(false);
  });
  row.appendChild(search);

  // "From:" picker — a native type-ahead over every source, most places first.
  const counts = new Map<string, { title: string; n: number }>();
  for (const x of items)
    for (const t of x.m.from ?? []) {
      const k = t.toLowerCase();
      const c = counts.get(k);
      if (c) c.n++;
      else counts.set(k, { title: t, n: 1 });
    }
  const listId = `geo-from-${Math.random().toString(36).slice(2, 8)}`;
  const list = el("datalist", "");
  list.id = listId;
  [...counts.values()]
    .sort((a, b) => b.n - a.n || a.title.localeCompare(b.title))
    .forEach((c) => {
      const o = document.createElement("option");
      o.value = c.title;
      o.label = `${c.n} place${c.n === 1 ? "" : "s"}`;
      list.appendChild(o);
    });
  const fromWrap = el("label", "geo-from");
  fromWrap.appendChild(el("span", "geo-from-label", "From"));
  const from = el("input", "geo-search geo-from-input");
  from.type = "search";
  from.placeholder = "any book, article or video";
  from.setAttribute("list", listId);
  from.setAttribute(
    "aria-label",
    "Show places from one book, article or video",
  );
  from.value = counts.get(state.from)?.title ?? "";
  const applyFrom = () => {
    const k = from.value.trim().toLowerCase();
    // Only an exact source title filters; partial typing just drives the suggestions.
    const next = counts.has(k) ? k : "";
    if (next === state.from) return;
    state.from = next;
    onChange(true);
  };
  from.addEventListener("input", applyFrom);
  from.addEventListener("change", applyFrom);
  fromWrap.append(from, list);
  row.appendChild(fromWrap);
  bar.appendChild(row);

  const chipRow = (
    label: string,
    defs: { key: string; label: string; color?: string }[],
    active: Set<string>,
    count: (key: string) => number,
  ) => {
    const present = defs.filter((d) => count(d.key) > 0);
    if (present.length < 2) return;
    const r = el("div", "geo-chips");
    r.appendChild(el("span", "geo-chips-label", label));
    for (const d of present) {
      const chip = el("button", "geo-chip is-active");
      chip.type = "button";
      chip.setAttribute("aria-pressed", "true");
      if (d.color) {
        const dot = el("span", "geo-chip-dot");
        dot.style.background = d.color;
        chip.appendChild(dot);
      }
      chip.append(
        d.label,
        " ",
        el("span", "geo-chip-count", String(count(d.key))),
      );
      // With everything on, a click shows only that chip; after that clicks
      // toggle, and turning the last one off restores all.
      chip.title = `Show only ${d.label.toLowerCase()}; click others to add them`;
      chip.addEventListener("click", () => {
        if (present.every((p) => active.has(p.key))) {
          // First click when everything is on: show only this one.
          active.clear();
          active.add(d.key);
        } else if (active.has(d.key)) {
          active.delete(d.key);
          if (!present.some((p) => active.has(p.key)))
            present.forEach((p) => active.add(p.key));
        } else {
          active.add(d.key);
        }
        r.querySelectorAll<HTMLButtonElement>(".geo-chip").forEach((c, i) => {
          const on = active.has(present[i].key);
          c.classList.toggle("is-active", on);
          c.setAttribute("aria-pressed", String(on));
        });
        onChange(false);
      });
      r.appendChild(chip);
    }
    bar.appendChild(r);
  };
  chipRow(
    "Medium",
    MEDIA,
    state.media,
    (k) => items.filter((x) => x.medium === k).length,
  );
  chipRow(
    "Role",
    ROLES,
    state.roles,
    (k) => items.filter((x) => x.roles.includes(k)).length,
  );

  const status = el("div", "geo-status");
  const shownEl = el("span", "");
  const reset = el("button", "geo-reset", "Reset");
  reset.type = "button";
  reset.addEventListener("click", () => {
    MEDIA.forEach((d) => state.media.add(d.key));
    ROLES.forEach((d) => state.roles.add(d.key));
    state.query = "";
    state.from = "";
    search.value = "";
    from.value = "";
    bar.querySelectorAll<HTMLButtonElement>(".geo-chip").forEach((c) => {
      c.classList.add("is-active");
      c.setAttribute("aria-pressed", "true");
    });
    onChange(true);
  });
  status.append(shownEl, reset);
  bar.appendChild(status);

  wrapper.insertBefore(bar, container);
  return (shown) => {
    shownEl.textContent =
      shown === items.length
        ? `${items.length} places`
        : `Showing ${shown} of ${items.length} places`;
    reset.hidden = shown === items.length && !state.from;
  };
}

/** Keep `?from=` in the address bar so a filtered view can be shared. */
function syncUrl(from: string, title: string | undefined) {
  try {
    const url = new URL(window.location.href);
    if (from && title) url.searchParams.set("from", title);
    else url.searchParams.delete("from");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // History API unavailable (sandboxed preview); filtering still works.
  }
}

function initGeoMaps(maplibregl: MapLibre) {
  document.querySelectorAll<HTMLElement>(".geo-map").forEach((node) => {
    const container = node as HTMLElement & { _geoMap?: MLMap };
    if (container._geoMap) return;

    const raw = container.getAttribute("data-geo-markers");
    if (!raw) return;
    let markers: GeoMarker[];
    try {
      markers = JSON.parse(raw);
    } catch {
      return;
    }
    if (!markers.length) return;

    const items: Indexed[] = markers.map((m) => ({
      m,
      medium: mediumOf(m),
      roles: m.roles ?? [],
      from: (m.from ?? []).map((t) => t.toLowerCase()),
      haystack: [
        m.title,
        ...(m.sources ?? []).flatMap((s) => [s.title, s.author]),
        ...(m.from ?? []),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase(),
    }));

    const state: FilterState = {
      media: new Set(MEDIA.map((d) => d.key)),
      roles: new Set(ROLES.map((d) => d.key)),
      query: "",
      from: (new URLSearchParams(window.location.search).get("from") ?? "")
        .trim()
        .toLowerCase(),
    };

    const map = new maplibregl.Map({
      container,
      style: styleUrl(),
      center: [0, 25],
      zoom: 1,
      // One world, not side-by-side copies at low zoom.
      renderWorldCopies: false,
      attributionControl: false,
    });
    container._geoMap = map;
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-left",
    );

    // One popup per map. Hovering a point previews it; clicking (or tapping)
    // pins it open until the map is clicked, Escape is pressed, or the filters
    // change. Moving the pointer onto a preview keeps it open for its links.
    const popup = new maplibregl.Popup({
      offset: 10,
      closeButton: false,
      closeOnClick: false,
      maxWidth: "min(320px, calc(100vw - 4rem))",
      // Hover previews must not steal focus (and draw a focus ring on the title).
      focusAfterOpen: false,
      className: "geo-popup",
    });
    let current: GeoMarker | null = null;
    let pinned = false;
    let hideTimer: number | undefined;
    const cancelHide = () => window.clearTimeout(hideTimer);
    const scheduleHide = () => {
      if (pinned) return;
      cancelHide();
      hideTimer = window.setTimeout(() => popup.remove(), 200);
    };
    const show = (m: GeoMarker) => {
      cancelHide();
      if (current === m && popup.isOpen()) return;
      popup.setLngLat([m.lng, m.lat]).setHTML(popupHtml(m)).addTo(map);
      current = m;
      const pe = popup.getElement();
      pe.addEventListener("mouseenter", cancelHide);
      pe.addEventListener("mouseleave", scheduleHide);
    };
    popup.on("close", () => {
      pinned = false;
      current = null;
    });
    container.addEventListener("keydown", (e) => {
      if (e.key === "Escape") popup.remove();
    });

    // Matching markers as GeoJSON; feature id = index into `markers`.
    let data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    const filtered = () => items.filter((x) => matches(x, state));
    const toGeoJSON = (xs: Indexed[]): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: xs.map((x) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [x.m.lng, x.m.lat] },
        properties: { i: markers.indexOf(x.m), medium: x.medium },
      })),
    });
    const fit = (xs: Indexed[]) => {
      if (!xs.length) return;
      if (xs.length === 1) {
        map.easeTo({
          center: [xs[0].m.lng, xs[0].m.lat],
          zoom: Math.max(map.getZoom(), 6),
        });
        return;
      }
      const b = new maplibregl.LngLatBounds();
      xs.forEach((x) => b.extend([x.m.lng, x.m.lat]));
      map.fitBounds(b, {
        padding: 50,
        maxZoom: 8,
        duration: map.loaded() ? 500 : 0,
      });
    };

    // (Re)add the clustered source and its layers. Runs on first load and
    // again after every theme switch, since setStyle replaces all layers.
    const addLayers = () => {
      if (map.getSource("geo")) return;
      map.addSource("geo", {
        type: "geojson",
        data,
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 11,
      });
      map.addLayer({
        id: "geo-clusters",
        type: "circle",
        source: "geo",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": CLUSTER_COLOR,
          "circle-opacity": 0.85,
          "circle-stroke-color": "#eceff4",
          "circle-stroke-width": 1.5,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            13,
            10,
            17,
            50,
            22,
            200,
            28,
          ],
        },
      });
      map.addLayer({
        id: "geo-cluster-count",
        type: "symbol",
        source: "geo",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#eceff4" },
      });
      map.addLayer({
        id: "geo-points",
        type: "circle",
        source: "geo",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "medium"],
            ...MEDIA.flatMap((d) => [d.key, d.color]),
            "#d8dee9",
          ] as unknown as string,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 5, 10, 8],
          "circle-stroke-color": "#2e3440",
          "circle-stroke-width": 1.5,
        },
      });
    };

    let setStatus: (n: number) => void = () => {};
    const render = (refit: boolean) => {
      const xs = filtered();
      data = toGeoJSON(xs);
      (
        map.getSource("geo") as
          { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
      )?.setData?.(data);
      popup.remove();
      setStatus(xs.length);
      const fromTitle = state.from
        ? xs[0]?.m.from?.find((t) => t.toLowerCase() === state.from)
        : undefined;
      syncUrl(state.from, fromTitle);
      if (refit) fit(xs);
    };

    const wrapper = container.parentElement;
    if (
      wrapper &&
      wrapper.classList.contains("geo-map-wrapper") &&
      !wrapper.querySelector(".geo-filter")
    ) {
      setStatus = buildFilterBar(wrapper, container, items, state, render);
    }

    map.on("style.load", addLayers);
    map.on("load", () => {
      addLayers();
      render(false);
      fitInitial();
    });

    map.on("mouseenter", "geo-points", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (f && !pinned) show(markers[f.properties?.i as number]);
    });
    map.on("mouseleave", "geo-points", () => {
      map.getCanvas().style.cursor = "";
      scheduleHide();
    });
    map.on(
      "mouseenter",
      "geo-clusters",
      () => (map.getCanvas().style.cursor = "pointer"),
    );
    map.on(
      "mouseleave",
      "geo-clusters",
      () => (map.getCanvas().style.cursor = ""),
    );
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, {
        layers: ["geo-points", "geo-clusters"],
      });
      const f = hit[0];
      if (!f) {
        popup.remove();
        return;
      }
      if (f.layer.id === "geo-clusters") {
        const src = map.getSource("geo") as unknown as {
          getClusterExpansionZoom: (id: number) => Promise<number>;
        };
        const center = (f.geometry as GeoJSON.Point).coordinates as [
          number,
          number,
        ];
        src
          .getClusterExpansionZoom(f.properties?.cluster_id as number)
          .then((zoom) => map.easeTo({ center, zoom: zoom + 0.5 }))
          .catch(() => map.easeTo({ center, zoom: map.getZoom() + 2 }));
        return;
      }
      const m = markers[f.properties?.i as number];
      if (pinned && current === m) {
        popup.remove();
        return;
      }
      pinned = false;
      show(m);
      pinned = true;
      // Bring the pinned place to just above centre so its popup fits the map.
      const lift = Math.min(120, container.clientHeight / 4);
      map.easeTo({ center: [m.lng, m.lat], offset: [0, -lift], duration: 300 });
    });

    // A `?from=` link zooms to that work's places; otherwise frame everything.
    const fitInitial = () => {
      map.resize();
      fit(state.from ? filtered() : items);
    };
    // The bases view-switcher keeps inactive views hidden, so the container can
    // be zero-size at init; fit again once it has a size.
    if (container.clientHeight === 0 && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (container.clientHeight > 0) {
          fitInitial();
          ro.disconnect();
        }
      });
      ro.observe(container);
    }
  });
}

async function run() {
  // Cheap guard: on non-map pages this is the only work the shim does.
  if (!document.querySelector(".geo-map")) return;
  try {
    const maplibregl = await loadMapLibre();
    initGeoMaps(maplibregl);
  } catch (e) {
    console.error(e);
  }
}

// Quartz emits `nav` on first load and on every SPA navigation.
document.addEventListener("nav", run);

// Live-swap the basemap style when the reader toggles light/dark. A full style
// reload drops our source and layers; each map re-adds them on `style.load`.
const themeHook = window as unknown as MapLibreWindow;
if (!themeHook.__geoThemeHook) {
  themeHook.__geoThemeHook = true;
  document.addEventListener("themechange", (e: Event) => {
    const detail = (e as CustomEvent<{ theme?: string }>).detail;
    const url = styleUrl(detail?.theme === "dark");
    document.querySelectorAll<HTMLElement>(".geo-map").forEach((node) => {
      const map = (node as HTMLElement & { _geoMap?: MLMap })._geoMap;
      if (map) map.setStyle(url, { diff: false });
    });
  });
}
