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
categories: ["[[Places]]"] # whatever your base filters on
coordinates: 48.8566,2.3522 # "lat,lng"
color: green # CSS color for a dot marker
icon: landmark # place type → emoji (see below)
flag: 🇫🇷 # optional: emoji rendered as the marker
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
  order:
    45 # MUST be < bases-page (50): the map view has to register
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

## Marker popups

Hovering a marker previews a popup; clicking (or tapping) pins it open. The
popup shows the place name (linking to its note), a short summary, and the works
that mention it:

- **Summary:** the note's `description` property, else its first prose paragraph.
- **Sources:** rows of an `## At a glance` table in the note body. Columns are
  matched by header (`Source`, `Author`, `Role`, `In one line`); only `Source`
  is required.

  ```markdown
  ## At a glance

  | Source                       | Author         | Role    | In one line                        |
  | ---------------------------- | -------------- | ------- | ---------------------------------- |
  | [[Not the End of the World]] | Hannah Ritchie | subject | Why boycotting palm oil backfires. |
  ```

  A `[[wikilink]]` source links to that note when it is published. Otherwise the
  popup links to the `[Original](https://…)` URL in the source's own
  `## Title — Author` section, if there is one. The popup lists three sources and
  links to the place note for the rest.

The search box matches place names, source titles and authors, so typing a book
title shows every place it mentions.

## `/map` page options

```yaml
- source: github:JasonSooter/quartz-geo-map
  options:
    title: Map
    description: Every place mentioned in the books, articles and videos I read.
    socialImage: map-og.jpg # under quartz/static/, or an absolute URL
```

`description` fills the page's meta and link-preview description. `socialImage`
sets its link-preview image; without it, og-image falls back to its default.

## Clustering and filters

Points are drawn as one clustered MapLibre layer, so nearby places merge into
numbered bubbles at low zoom (click one to zoom in). Each point is coloured by
medium, and the filter bar above the map narrows what is shown:

- **Search** matches place names, source titles and authors.
- **From** is a type-ahead over every source title; picking one shows only that
  work's places and zooms to them. The choice is kept in the URL, so
  `/map?from=Full%20Tilt` links straight to one book's places.
- **Medium** chips (books, articles, videos, podcasts, travel) come from the
  note's `icon`; **Role** chips fold each source's role into subject, setting,
  journey, turning point, backdrop or other.

With every chip in a row on, clicking one shows only that one; after that,
clicks toggle chips on and off.
