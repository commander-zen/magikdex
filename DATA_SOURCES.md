# magıcdex Data Sources & Compliance
### Standing rules for Scryfall, EDHREC, and external data
*Source: Scryfall API terms (scryfall.com/docs/api). Re-checked before any data work.*

This file is read before touching any external data source. It is not a
one-time review. It encodes the rules that keep magıcdex's API access
alive — a ban kills the app.

---

## Scryfall — rate & good citizenship

- Insert 50–100ms delay between requests to api.scryfall.com (~10/sec
  max). Excessive requests → HTTP 429 → continued overload → IP ban.
- NEVER loop card-by-card against the live API. Batch, paginate with
  delay, or read from local cache.
- *.scryfall.io image origins are NOT rate-limited (card images are
  safe to load freely); only api.scryfall.com is.

## Scryfall — cache locally, this is the intended architecture

- Scryfall explicitly encourages caching downloaded data in your own DB,
  at least 24h, and provides daily BULK DATA files of the entire database.
- Gameplay data (names, oracle text, type, mana cost, color identity)
  changes rarely — weekly or post-set-release refresh is sufficient.
- Prices update only once daily; fetching more often yields nothing new.
- TARGET ARCHITECTURE: ingest Scryfall bulk gameplay data into Supabase
  on a schedule; the app reads OUR database; hit the live API only for
  what the cache can't serve. Faster for users, survives outages, polite
  by construction. The per-legend EDHREC cache follows the same pattern:
  cache locally, refresh on schedule, read from our backend.

## Scryfall — image rules (compliance-critical)

- When showing art_crop, the artist name + copyright must be identifiable
  somewhere in the SAME interface (or show the full card image there).
- NEVER crop/clip the copyright or artist name off a full card image.
- NEVER distort, skew, stretch, blur, sharpen, DESATURATE, or color-shift
  card images. (Grayscale on card art is a VIOLATION — see UX note below.)
- No own watermarks/stamps/logos on card images.
- Don't imply non-WotC authorship or another game.

## Scryfall — product rules

- No paywalling Scryfall data. Anonymous/free access to card data must
  remain. (magıcdex is free — compliant by design; protect this.)
- Must add value, not merely repackage/proxy Scryfall data.
- No Scryfall logos or implied endorsement.

## EDHREC

- No official public API. Endpoints are unofficial and rate-hostile.
- Same caching discipline: scheduled fetch into Supabase, app reads our
  cache, never live per-request.

---

## Open compliance items

- GREYSCALE GATE: the Box's grayscale-until-100 effect desaturates
  Scryfall art = violation. INTERIM FIX: a dimming/scrim OVERLAY on top
  of unaltered art, not a CSS filter on the art. FUTURE FIX: pixel
  sprites (subtype-keyed) replace card art in slots entirely, removing
  the image-terms question for tiles altogether (own assets, not
  Scryfall art).
- ART_CROP ATTRIBUTION: confirm the artist/copyright is identifiable in
  any interface presenting art_crop (the Home detail pane's full card
  may satisfy this for the Box — verify).

---

*Cache locally. Delay between calls. Never alter card images. Stay free.
A ban ends the app — these are not optional.*
