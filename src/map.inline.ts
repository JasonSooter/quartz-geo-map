// Lazy client shim. Compiles to a tiny script that ships in Quartz's shared
// postscript, but the heavy MapLibre GL library is only fetched on demand — the
// first time a page actually contains a `.geo-map` element. MapLibre renders
// OpenStreetMap vector tiles (via OpenFreeMap) so streets stay crisp at every
// zoom. MapLibre's CSS is injected separately (page-scoped) via the view's `css`.

const MAPLIBRE_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";

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
  if (libPromise) return libPromise;
  libPromise = new Promise<MapLibre>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MAPLIBRE_JS;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => {
      const lib = (window as unknown as MapLibreWindow).maplibregl;
      lib ? resolve(lib) : reject(new Error("geo-map: MapLibre GL loaded but global missing"));
    };
    s.onerror = () => reject(new Error("geo-map: failed to load MapLibre GL"));
    document.head.appendChild(s);
  });
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
}

// Lucide icon names (from the `icon` property / Bases markerIcon) mapped to an
// emoji glyph. Extend as new place types get their own marker. Types without an
// entry (city, state, continent) fall back to a colored dot.
const ICON_EMOJI: Record<string, string> = {
  landmark: "🏛️",
  museum: "🖼️",
  park: "🌳",
  coworking: "💻",
  mention: "📖",
};

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function isDark(): boolean {
  return document.documentElement.getAttribute("saved-theme") === "dark";
}

function styleUrl(dark: boolean = isDark()): string {
  return dark ? STYLE_DARK : STYLE_LIGHT;
}

function markerElement(m: GeoMarker): HTMLElement {
  const el = document.createElement("div");
  const emoji = m.flag || (m.icon ? ICON_EMOJI[m.icon] : undefined);
  if (emoji) {
    el.className = "geo-pin geo-pin-emoji";
    el.textContent = emoji;
  } else {
    el.className = "geo-pin";
    el.style.background = m.color || "#2563eb";
  }
  return el;
}

function initGeoMaps(maplibregl: MapLibre) {
  document.querySelectorAll<HTMLElement>(".geo-map").forEach((el) => {
    const container = el as HTMLElement & { _geoMap?: MLMap };
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

    const map = new maplibregl.Map({
      container,
      style: styleUrl(),
      center: [0, 25],
      zoom: 1,
      attributionControl: false,
    });
    container._geoMap = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    const bounds = new maplibregl.LngLatBounds();
    for (const m of markers) {
      const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
        `<a href="${escapeHtml(m.url)}" class="internal">${escapeHtml(m.title)}</a>`,
      );
      new maplibregl.Marker({ element: markerElement(m), anchor: "center" })
        .setLngLat([m.lng, m.lat])
        .setPopup(popup)
        .addTo(map);
      bounds.extend([m.lng, m.lat]);
    }

    const applyView = () => {
      map.resize();
      if (markers.length === 1) {
        map.jumpTo({ center: [markers[0].lng, markers[0].lat], zoom: 6 });
      } else {
        map.fitBounds(bounds, { padding: 40, maxZoom: 6, duration: 0 });
      }
    };
    // The bases view-switcher keeps inactive views hidden (no `is-active`), so
    // the map container is often zero-size at init. Fit only once it has a size.
    if (container.clientHeight > 0) {
      applyView();
    } else if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (container.clientHeight > 0) {
          applyView();
          ro.disconnect();
        }
      });
      ro.observe(container);
    } else {
      setTimeout(applyView, 250);
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

// Live-swap the basemap style when the reader toggles light/dark. HTML markers
// persist across setStyle, so only the tiles change.
const themeHook = window as unknown as MapLibreWindow;
if (!themeHook.__geoThemeHook) {
  themeHook.__geoThemeHook = true;
  document.addEventListener("themechange", (e: Event) => {
    const detail = (e as CustomEvent<{ theme?: string }>).detail;
    const url = styleUrl(detail?.theme === "dark");
    document.querySelectorAll<HTMLElement>(".geo-map").forEach((el) => {
      const map = (el as HTMLElement & { _geoMap?: MLMap })._geoMap;
      if (map) map.setStyle(url);
    });
  });
}
