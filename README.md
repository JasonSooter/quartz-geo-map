# geo-map

An interactive map for Quartz, rendered with **MapLibre GL** over **OpenFreeMap**
vector tiles (OpenStreetMap data, keyless). It provides **two independent ways**
to put a note on a map — use either or both.

## 1. Note-level pins (Bases map view)

Registers a `map` view type into [`bases-page`](https://github.com/quartz-community/bases-page)'s
view registry (the built-in bases map view is only a placeholder). Any `.base`
file with a `type: map` view renders as an interactive map, one pin per matching
note, read from the note's **frontmatter**:

```yaml
---
categories: ["[[Places]]"]   # whatever your base filters on
coordinates: 48.8566,2.3522  # "lat,lng"
color: green                 # CSS color for a dot marker
icon: landmark               # place type → emoji (see below)
flag: 🇫🇷                     # optional: emoji rendered as the marker
---
```

> [!important]
> Obsidian accepts `categories == ["[[Places]]"]` as a base filter, but Quartz's
> bases compiler evaluates that to **zero rows**. Use
> `categories.containsAny(link("Places"))` instead.

## 2. Inline locations (the `/map` page)

Tag a location **anywhere in any note body** and it appears on a generated
`/map` page — travel notes, book notes, blog posts, etc.:

```markdown
The estate is filmed at [Highclere Castle](geo:51.3268,-1.3617) #place/mention
- [Louvre Museum](geo:48.8606,2.3376) #place/museum
```

A `transformer` scans every note for `[label](geo:lat,lng)` links (keeping the
trailing `#place/…` tag), and a `pageType` generates `/map` aggregating **all**
inline references **plus** every note-level `coordinates` pin — one comprehensive
"every reference to a location" map.

## Marker styling

- `flag: <emoji>` renders that emoji directly (national flags for countries).
- `icon` / the `#place/<type>` tag maps to an emoji: `landmark` 🏛️, `museum` 🖼️,
  `park` 🌳, `coworking` 💻, `mention` 📖. Unmapped types fall back to a colored
  dot using `color`.
- Popups link back to the source note.
- Tiles: `liberty` (light) / `fiord` (dark), swapped live with the theme toggle.
  Change the `STYLE_LIGHT` / `STYLE_DARK` constants in `src/map.inline.ts`.

## Install / config

Local plugin — referenced by path in `quartz.config.yaml`:

```yaml
- source: ./plugins/geo-map
  enabled: true
  order: 45   # MUST be < bases-page (50): the map view has to register
              # before BasesBody snapshots the view registry.
```

Rebuild the plugin after edits: `cd plugins/geo-map && npm run build` (commits
`dist/` per Quartz v5 plugin convention).

## Performance

- MapLibre GL loads from CDN **on demand**, only on pages that contain a map — a
  ~2.3 KB shim ships in the shared postscript; the library itself is never in a
  site-wide bundle.
- The map CSS is injected only on pages with a map view.

## Publishing `.base` files

quartz-syncer publishes Markdown only — it does **not** publish `.base` files. So
a base that defines a map page (e.g. `Map View.base`) must be committed into
`content/` directly (the vault stays the source of truth; the `content/` copy is
a build mirror). The `/map` page has no such caveat — it's generated from note
bodies, which publish normally.
