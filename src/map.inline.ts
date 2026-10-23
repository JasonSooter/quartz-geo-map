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
  /** Every source author (uncapped) — the author filter. */
  by?: string[];
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
  /** Lowercased authors, for the exact author match. */
  by: string[];
  /** Lowercased title + source titles + authors, for the search box. */
  haystack: string;
}

interface FilterState {
  media: Set<string>;
  roles: Set<string>;
  query: string;
  /** Lowercased source title, or "" for any. */
  from: string;
  /** Lowercased author, or "" for any. */
  by: string;
}

function matches(x: Indexed, f: FilterState): boolean {
  if (!f.media.has(x.medium)) return false;
  // Places with no recorded role (travel places, inline mentions) ignore the role filter.
  if (x.roles.length && !x.roles.some((r) => f.roles.has(r))) return false;
  if (f.from && !x.from.includes(f.from)) return false;
  if (f.by && !x.by.includes(f.by)) return false;
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

/** A display name and how many (currently matching) places it covers. */
interface Named {
  name: string;
  n: number;
  medium?: string;
}

/** Rank names by how well they match `q`: prefix, then word start, then anywhere. */
function rankMatches(names: Named[], q: string, limit: number): Named[] {
  const score = (name: string) => {
    const l = name.toLowerCase();
    if (l.startsWith(q)) return 0;
    if (l.includes(` ${q}`)) return 1;
    return l.includes(q) ? 2 : -1;
  };
  return names
    .map((x) => ({ x, s: q ? score(x.name) : 0 }))
    .filter((r) => r.s >= 0)
    .sort(
      (p, r) => p.s - r.s || r.x.n - p.x.n || p.x.name.localeCompare(r.x.name),
    )
    .slice(0, limit)
    .map((r) => r.x);
}

// Filter bar above the map: one smart search box (free text plus suggestions
// for works, authors and places), medium and role chips, and a live count.
// Every change calls `onChange`; the map re-renders its clustered source.
function buildFilterBar(
  wrapper: HTMLElement,
  container: HTMLElement,
  items: Indexed[],
  state: FilterState,
  names: { works: Map<string, string>; authors: Map<string, string> },
  onChange: (refit: boolean) => void,
  onPickPlace: (m: GeoMarker) => void,
): (shown: number) => void {
  const bar = el("div", "geo-filter");
  const uid = Math.random().toString(36).slice(2, 8);

  // ── Smart search: input + suggestion listbox + active filter chips ──
  const row = el("div", "geo-filter-row");
  const combo = el("div", "geo-combo");
  const search = el("input", "geo-search");
  search.type = "search";
  search.placeholder = "Search places, books, authors…";
  search.autocomplete = "off";
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-label", "Search places, books and authors");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-expanded", "false");
  const list = el("ul", "geo-suggest");
  list.id = `geo-suggest-${uid}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  search.setAttribute("aria-controls", list.id);
  combo.append(search, list);
  const active = el("div", "geo-active");
  row.append(combo, active);
  bar.appendChild(row);

  type Option = {
    kind: "work" | "author" | "place";
    key: string;
    label: string;
    n?: number;
    medium?: string;
    m?: GeoMarker;
  };
  let options: Option[] = [];
  let cursor = -1;

  const scoped = () => items.filter((x) => matches(x, { ...state, query: "" }));

  const suggest = () => {
    const q = search.value.trim().toLowerCase();
    const pool = scoped();
    const works = new Map<string, Named>();
    const authors = new Map<string, Named>();
    for (const x of pool) {
      x.from.forEach((k) => {
        const w = works.get(k);
        if (w) w.n++;
        else
          works.set(k, {
            name: names.works.get(k) ?? k,
            n: 1,
            medium: x.medium,
          });
      });
      x.by.forEach((k) => {
        const w = authors.get(k);
        if (w) w.n++;
        else authors.set(k, { name: names.authors.get(k) ?? k, n: 1 });
      });
    }
    if (state.from) works.delete(state.from);
    if (state.by) authors.delete(state.by);
    const opts: Option[] = [];
    const add = (kind: Option["kind"], xs: Named[]) =>
      xs.forEach((w) =>
        opts.push({
          kind,
          key: w.name.toLowerCase(),
          label: w.name,
          n: w.n,
          medium: w.medium,
        }),
      );
    add("work", rankMatches([...works.values()], q, q ? 5 : 6));
    add("author", rankMatches([...authors.values()], q, q ? 4 : 3));
    if (q) {
      pool
        .filter((x) => x.m.title.toLowerCase().includes(q))
        .sort(
          (p, r) =>
            Number(!p.m.title.toLowerCase().startsWith(q)) -
            Number(!r.m.title.toLowerCase().startsWith(q)),
        )
        .slice(0, 5)
        .forEach((x) =>
          opts.push({
            kind: "place",
            key: x.m.title.toLowerCase(),
            label: x.m.title,
            m: x.m,
          }),
        );
    }
    options = opts;
    cursor = -1;
    renderList();
  };

  const GROUP: Record<Option["kind"], string> = {
    work: "Books, articles & videos",
    author: "Authors",
    place: "Places",
  };
  const renderList = () => {
    list.replaceChildren();
    let group = "";
    options.forEach((o, i) => {
      if (o.kind !== group) {
        group = o.kind;
        const h = el("li", "geo-suggest-group", GROUP[o.kind]);
        h.setAttribute("role", "presentation");
        list.appendChild(h);
      }
      const li = el("li", "geo-suggest-item");
      li.id = `${list.id}-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === cursor));
      if (o.medium) {
        const dot = el("span", "geo-chip-dot");
        dot.style.background =
          MEDIA.find((d) => d.key === o.medium)?.color ?? "";
        li.appendChild(dot);
      }
      li.appendChild(el("span", "geo-suggest-label", o.label));
      if (o.n !== undefined)
        li.appendChild(
          el("span", "geo-chip-count", `${o.n} place${o.n === 1 ? "" : "s"}`),
        );
      // mousedown, not click: fires before the input's blur closes the list.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(o);
      });
      list.appendChild(li);
    });
    const open = options.length > 0 && document.activeElement === search;
    list.hidden = !open;
    search.setAttribute("aria-expanded", String(open));
    if (cursor >= 0)
      search.setAttribute("aria-activedescendant", `${list.id}-${cursor}`);
    else search.removeAttribute("aria-activedescendant");
  };
  const close = () => {
    list.hidden = true;
    search.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
  };

  const renderActive = () => {
    active.replaceChildren();
    const chip = (label: string, clear: () => void) => {
      const c = el("button", "geo-chip is-active geo-active-chip");
      c.type = "button";
      c.append(label, " ", el("span", "geo-chip-x", "×"));
      c.setAttribute("aria-label", `Remove filter ${label}`);
      c.addEventListener("click", () => {
        clear();
        renderActive();
        onChange(true);
        search.focus();
      });
      active.appendChild(c);
    };
    if (state.from)
      chip(
        `From: ${names.works.get(state.from) ?? state.from}`,
        () => (state.from = ""),
      );
    if (state.by)
      chip(
        `By: ${names.authors.get(state.by) ?? state.by}`,
        () => (state.by = ""),
      );
  };

  const pick = (o: Option) => {
    if (o.kind === "place" && o.m) {
      close();
      onPickPlace(o.m);
      return;
    }
    if (o.kind === "work") state.from = o.key;
    if (o.kind === "author") state.by = o.key;
    // The chip now carries the filter; the box is free for keywords within it.
    search.value = "";
    state.query = "";
    renderActive();
    onChange(true);
    suggest();
  };

  search.addEventListener("input", () => {
    state.query = search.value.trim().toLowerCase();
    onChange(false);
    suggest();
  });
  search.addEventListener("focus", suggest);
  search.addEventListener("blur", close);
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      if (list.hidden) suggest();
      const n = options.length;
      cursor =
        e.key === "ArrowDown"
          ? (cursor + 1) % n
          : cursor <= 0
            ? n - 1
            : cursor - 1;
      renderList();
    } else if (e.key === "Enter") {
      if (cursor >= 0 && options[cursor]) {
        e.preventDefault();
        pick(options[cursor]);
      } else close();
    } else if (e.key === "Escape") {
      if (!list.hidden) {
        e.preventDefault();
        close();
      }
    } else if (
      e.key === "Backspace" &&
      !search.value &&
      (state.by || state.from)
    ) {
      // Backspace in an empty box removes the last filter chip.
      if (state.by) state.by = "";
      else state.from = "";
      renderActive();
      onChange(true);
    }
  });
  renderActive();

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
      chip.title = `Show only ${d.label.toLowerCase()}; click others to add them`;
      // With everything on, a click shows only that chip; after that clicks
      // toggle, and turning the last one off restores all.
      chip.addEventListener("click", () => {
        if (present.every((p) => active.has(p.key))) {
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
    state.by = "";
    search.value = "";
    renderActive();
    bar
      .querySelectorAll<HTMLButtonElement>(".geo-chips .geo-chip")
      .forEach((c) => {
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
    reset.hidden = shown === items.length && !state.from && !state.by;
  };
}

/** Keep `?from=` / `?by=` in the address bar so a filtered view can be shared. */
function syncUrl(params: Record<string, string | undefined>) {
  try {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
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
      by: (m.by ?? []).map((t) => t.toLowerCase()),
      haystack: [
        m.title,
        ...(m.sources ?? []).flatMap((s) => [s.title, s.author]),
        ...(m.from ?? []),
        ...(m.by ?? []),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase(),
    }));

    // Lowercased key → display name, for chips, suggestions and the URL.
    const names = {
      works: new Map<string, string>(),
      authors: new Map<string, string>(),
    };
    for (const m of markers) {
      m.from?.forEach((t) => names.works.set(t.toLowerCase(), t));
      m.by?.forEach((t) => names.authors.set(t.toLowerCase(), t));
    }
    const params = new URLSearchParams(window.location.search);
    const fromParam = (k: string, known: Map<string, string>) => {
      const v = (params.get(k) ?? "").trim().toLowerCase();
      return known.has(v) ? v : "";
    };
    const state: FilterState = {
      media: new Set(MEDIA.map((d) => d.key)),
      roles: new Set(ROLES.map((d) => d.key)),
      query: "",
      from: fromParam("from", names.works),
      by: fromParam("by", names.authors),
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
      syncUrl({
        from: names.works.get(state.from),
        by: names.authors.get(state.by),
      });
      if (refit) fit(xs);
    };

    const wrapper = container.parentElement;
    if (
      wrapper &&
      wrapper.classList.contains("geo-map-wrapper") &&
      !wrapper.querySelector(".geo-filter")
    ) {
      setStatus = buildFilterBar(
        wrapper,
        container,
        items,
        state,
        names,
        render,
        (m) => {
          // A place picked from search: zoom in close and pin its popup.
          pinned = false;
          show(m);
          pinned = true;
          const lift = Math.min(120, container.clientHeight / 4);
          map.easeTo({
            center: [m.lng, m.lat],
            zoom: Math.max(map.getZoom(), 9),
            offset: [0, -lift],
            duration: 600,
          });
        },
      );
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
      fit(state.from || state.by ? filtered() : items);
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
