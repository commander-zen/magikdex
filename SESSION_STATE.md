# SESSION_STATE — MTG DNA

## Cold Start Prompt
Priority: **RUN THE MIGRATION** — `mtg-dna/supabase/migrations/002_legends.sql` must be run manually in the Supabase SQL editor before the Vault form or Brew save will work. After that: wire mode-specific behavior in Brew (`brewMode` is stored but all four modes currently route to the same search screen — Import Deck especially needs its own flow, the ported ImportSheet is a candidate), then end-to-end test of search → swipe → review → save.

## Done
- ✅ 2026-06-10 — Brew overhaul (visual/interaction pass):
  - ✅ Forced dark palette for all Brew sub-screens (`BREW` constants in Brew.jsx: #0a0e1a base, #e8a020 amber, #7ab89a green) — sub-screens no longer follow app light mode
  - ✅ Mode-select screen between chip tap and search: New Legend / Import Deck / Free Pile / Card Discovery, PageHeader pattern (HELIX eyebrow, brew title, amber rule), ToolChips-style rows
  - ✅ Card display frameless — removed surface background, bevel border, box shadow, and the full-screen gradient overlay
  - ✅ Persistent gesture legend (`← pass  ↑ mainboard  ↓ maybe  → keep`, Noto Sans Mono, dimmed) replaces the one-time animated hint; tip code + TIP_KEY usage removed
  - ✅ Swipe rewritten flat: translate-only (no rotation), no KEEP/PASS/DECKLIST/MAYBE stamps, no color tint; up flies to top (mainboard), down to bottom (maybe)
  - ✅ SearchScreen SEARCH button white Win98 bevels removed; done-state buttons re-palette'd; scope held to Brew files only

## Done (earlier)
- ✅ 2026-06-10 — Legends schema + full brew flow (prompts 1–5):
  - ✅ P1: `supabase/migrations/002_legends.sql` written — legends table, `decks.legend_id` + `build_name`, `url`/`platform` made nullable. **NOT yet run** (needs SQL editor; no CLI/service key available)
  - ✅ P2: Vault deck registry restored from `a0a6016` (it was deliberately stripped in the e968083 redesign) with the two-field pattern: commander name → legends upsert, build name → `decks.build_name`; legacy `legend` text column kept in sync; `deck_name` insert dropped (column doesn't exist in live schema)
  - ✅ P3: `onSearch` wired to `fetchFirstPageForSwipe` (≤175 cards/page); errors render in SearchScreen; sort changes re-fetch
  - ✅ P4: four-direction gesture map in SwipeScreen — left pass, right keep, up decklist (new board + prop), down maybe; dominant axis wins; DECKLIST/MAYBE drag labels; ArrowUp/Down keys; undo covers all three boards; useGameChangers + useDoubleTap (flip) now used
  - ✅ P5: new ReviewScreen (presentational) groups pile/decklist/maybe with quantities; save flow in Brew.jsx: upsert legend → insert deck → batch-insert deck_cards (`section` ∈ pile/decklist/maybe)
  - ✅ `vite build` passes (438 kB — swipe/review now bundled); live schema verified via REST probes (anon writes pass RLS)
- ✅ 2026-06-10 — SearchScreen copy cleanup:
  - ✅ Removed "DECK STACK" heading, "Search. Swipe. Brew." tagline, Deck Stack description line, swipe-hint line, and the Bluesky/GitHub footer links
  - ✅ Copy removal only — no layout/logic/style edits; spacer + input + progress bar + SEARCH button untouched
  - ✅ `vite build` passes; grep confirms no target copy remains
- ✅ 2026-06-10 — Helix: Brew tap target wired:
  - ✅ Brew.jsx: `brewView` state ("shell" | "search"); shell renders PageHeader + ToolChips as before; "search" renders SearchScreen in a position:fixed inset-0 zIndex:50 takeover with `brewThemeVars()` re-added, scoped to the takeover wrapper
  - ✅ tools.js: Helix: Brew entry carries `action: "brew-search"`; Brew.jsx resolves it to a live onClick (static data can't close over component state)
  - ✅ ToolChips.jsx: rows call `tool.onClick` on tap; `target="_blank"`/`rel` only set when a `url` exists; pointer cursor on actionable rows
  - ✅ Back button rendered in the takeover wrapper (top-left, 44px target) — exits to shell
  - ✅ `vite build` passes (210 kB; SearchScreen + settings back in bundle)
- ✅ 2026-06-10 — Brew tab reverted + tools data:
  - ✅ `src/pages/Brew.jsx` restored byte-identical to pre-prompt-7 shell (PageHeader + ToolChips)
  - ✅ "Helix: Brew" added as first BREW_TOOLS entry, no tier, same shape as other entries
  - ✅ ToolChips renders untiered entries above tier groups (see Known Issues — required deviation)
  - ✅ `vite build` passes; bundle back to 203 kB (brew-components tree-shaken once unreferenced)
- ✅ 2026-06-10 — Brew port, prompts 1–8:
  - ✅ P1–4: `scryfall.js`, `wrec.js` → `src/lib/`; `useDoubleTap.js`, `useGameChangers.js` → `src/hooks/`; `brewPrompt.js`, `validateBrewQuery.js` → `src/services/` (byte-exact copies)
  - ✅ P5: 9 components → `src/brew-components/`, 3 screens → `src/brew-components/screens/` (byte-exact copies)
  - ✅ P6: font swaps (Space Grotesk/DM Sans → Noto Sans, IBM Plex Mono → Noto Sans Mono), import-path fixes for the screens subfolder, `NAV_HEIGHT` inlined (60), Deck Stack CSS vars bridged to MTG DNA theme tokens via `brewThemeVars()` in `src/pages/Brew.jsx`
  - ✅ P7: Brew tab renders SearchScreen below PageHeader; ToolChips removed from Brew (still used by Notebook/Table/Vault); supabase client passed as prop
  - ✅ P8: localStorage keys renamed (`ds_search_history`→`helixbrew_search_history`, `ds_swipe_hint_shown`→`helixbrew_swipe_hint_shown`, `cardstock_settings`→`helixbrew_settings`); zero deck-stack auth/db/supabase imports; `vite build` passes; all 12 brew files parse clean

## Known Issues
- **Vault reverted to shell (2026-06-10)**: per request, Vault.jsx is back to the bare PageHeader + ToolChips state (`b63d5cd^` / e968083, byte-identical). The commander+build registry form from `b63d5cd` is gone again — recover it from that commit if wanted. `lib/fetchDecklist.js` is now unused by any page.
- **Migration 002 not run**: Brew saves will fail with column/table errors until `002_legends.sql` runs in the SQL editor. The app builds and browses fine without it.
- **brewMode is cosmetic**: the mode selector stores the choice but all four modes route to the same search screen; no mode-specific behavior yet.
- **Brew board naming**: internal state/props/db section say `decklist`; user-facing copy now says "mainboard" (gesture legend, done state). Rename pass may be wanted before the section values calcify in deck_cards rows.
- **First-run swipe tip removed**: `helixbrew_swipe_hint_shown` is no longer read or written (persistent gesture legend replaced it); stale keys may linger in users' localStorage harmlessly.
- **decks.platform CHECK constraint**: live values allow at least `moxfield`/`archidekt`; brew-created decks insert `platform: null` (allowed once 002 makes it nullable). If a 'brew' platform value is wanted later, the CHECK needs altering.
- **Write-tool NUL corruption (caught)**: two NUL bytes landed in Brew.jsx during this session's write (would have corrupted saved card rows); stripped and verified repo-wide — no other text files affected.
- **Commander identity is name-only**: legends rows store just `name` for now; `scryfall_id`/`image_uri` are nullable and unpopulated. Enrichment via `fetchCardByName` is a natural follow-up.
- **SwipeScreen sort re-fetches mid-stack**: changing sort re-runs the search and resets the index; already-swiped cards reappear (dedup only filters pile, not decklist/maybe).
- **SearchScreen has no heading at all now**: the Deck Stack copy was removed without replacement (per spec), so the takeover shows a mostly-empty screen with the input/button pushed to the bottom by the flex spacer. Needs Helix: Brew copy in the design pass.
- **SearchScreen ignores `onBack`**: it has no back affordance or `onBack` prop in its JSX. Brew.jsx passes `onBack` anyway (future use) and renders its own back button in the takeover wrapper as the actual exit.
- **`onSearch` is a stub**: console.log only. SwipeScreen/PileScreen pile flow not wired; those components plus sheets/modals/services remain unreferenced and tree-shaken.
- **"No other files touched" deviation (2026-06-10)**: ToolChips groups strictly by tier S/A/B — a tierless entry would not render at all. To make "Helix: Brew" appear first with no tier label, `src/components/ToolChips.jsx` was modified: row markup extracted to a shared `renderRow`, untiered entries render above the tier groups with identical styling and no heading. Same file later gained `tool.onClick` support for the tap wiring.
- **Source snapshot**: deck-stack HEAD deleted SwipeScreen/SearchScreen/PileScreen in commit `33f167f` ("demolish old swipe/pile/search architecture", 2026-05-20). All files were copied from `33f167f^`, the last commit where screens and components coexisted. This predates deck-stack's May 21–23 redesign commits (Noto Sans migration, Y2K-strip) — fonts were handled in P6 anyway, but the copies are NOT deck-stack HEAD.
- **P6 deviation**: the prompt's find-and-replace spec (Bebas Neue/DM Sans literals, `--bg`/`--panel` var set, auth/db import strips) didn't match the snapshot — files had no auth/db imports, fonts were mostly `var(--font-system)`, and styling uses deck-stack's Win98 token system (`--color-*`, `--bevel-*`, `--space-*`) in module-level style objects that can't call useTheme(). Instead of ~300 inline rewrites, all deck-stack CSS vars are defined from MTG DNA theme tokens in `brewThemeVars()` (Brew.jsx). Components keep `var(--x)` references and re-theme automatically, including light/dark.
- **P7 deviation**: SearchScreen's props are `{ onSearch, loading, error, commanderCard, onCommanderCardChange }` — it doesn't accept a Supabase client. The client is passed as a `supabase` prop anyway (ignored for now). `onSearch` is a console.log stub; the search→pile flow isn't wired.
- **Extra deps copied** (not in the prompt list, required by imports): `src/lib/settings.js`, `src/constants/wrec.js`. `NAV_HEIGHT` (60) inlined where BottomNav was imported — verify against MTG DNA's actual NavBar height in the visual pass.
- SearchScreen still shows "DECK STACK" branding, deck-stack's Bluesky/GitHub footer links, and `error` prop is never rendered in its JSX.
- `services/brewPrompt.js` + `validateBrewQuery.js` and most brew components (SwipeScreen, PileScreen, sheets, modals) are copied but not yet reachable from the app — Vite tree-shakes them until wired.
