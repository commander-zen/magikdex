# SESSION_STATE — MTG DNA

## Cold Start Prompt
Priority: Hook up the "Helix: Brew" entry in BREW_TOOLS — it renders first in the Brew tool list but has no `url`, so tapping it does nothing. Decide destination (route to the brew experience vs. external link), then resume the visual iteration pass on the ported brew-components (still in repo at `src/brew-components/`, currently unreferenced/tree-shaken).

## Done
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
- **"No other files touched" deviation (2026-06-10)**: ToolChips groups strictly by tier S/A/B — a tierless entry would not render at all. To make "Helix: Brew" appear first with no tier label, `src/components/ToolChips.jsx` was modified: row markup extracted to a shared `renderRow`, untiered entries render above the tier groups with identical styling and no heading.
- **Helix: Brew entry is not a working link**: it has no `url`, so its row renders (name, desc, arrow) but navigates nowhere. Needs a destination — likely an in-app route to the brew experience.
- **Brew port is parked, not removed**: prompts 1–8 artifacts (`src/brew-components/`, `src/lib/scryfall.js`, `settings.js`, `wrec.js`, `src/constants/wrec.js`, hooks, services) remain in the repo but nothing imports them since the Brew.jsx revert. The `brewThemeVars()` CSS-var bridge that lived in Brew.jsx was removed with the revert — re-add it when re-wiring.
- **Source snapshot**: deck-stack HEAD deleted SwipeScreen/SearchScreen/PileScreen in commit `33f167f` ("demolish old swipe/pile/search architecture", 2026-05-20). All files were copied from `33f167f^`, the last commit where screens and components coexisted. This predates deck-stack's May 21–23 redesign commits (Noto Sans migration, Y2K-strip) — fonts were handled in P6 anyway, but the copies are NOT deck-stack HEAD.
- **P6 deviation**: the prompt's find-and-replace spec (Bebas Neue/DM Sans literals, `--bg`/`--panel` var set, auth/db import strips) didn't match the snapshot — files had no auth/db imports, fonts were mostly `var(--font-system)`, and styling uses deck-stack's Win98 token system (`--color-*`, `--bevel-*`, `--space-*`) in module-level style objects that can't call useTheme(). Instead of ~300 inline rewrites, all deck-stack CSS vars are defined from MTG DNA theme tokens in `brewThemeVars()` (Brew.jsx). Components keep `var(--x)` references and re-theme automatically, including light/dark.
- **P7 deviation**: SearchScreen's props are `{ onSearch, loading, error, commanderCard, onCommanderCardChange }` — it doesn't accept a Supabase client. The client is passed as a `supabase` prop anyway (ignored for now). `onSearch` is a console.log stub; the search→pile flow isn't wired.
- **Extra deps copied** (not in the prompt list, required by imports): `src/lib/settings.js`, `src/constants/wrec.js`. `NAV_HEIGHT` (60) inlined where BottomNav was imported — verify against MTG DNA's actual NavBar height in the visual pass.
- SearchScreen still shows "DECK STACK" branding, deck-stack's Bluesky/GitHub footer links, and `error` prop is never rendered in its JSX.
- `services/brewPrompt.js` + `validateBrewQuery.js` and most brew components (SwipeScreen, PileScreen, sheets, modals) are copied but not yet reachable from the app — Vite tree-shakes them until wired.
