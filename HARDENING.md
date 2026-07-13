# HARDENING.md — Pre-Launch Security & Compliance Audit (magikdex)

**Audited:** 2026-07-12 · **Scope:** Phase 1, audit only — nothing changed.
**Context:** solo dev, public Reddit launch imminent; also a paid iOS App Store build (Capacitor). Threat model = curious strangers with dev tools + scripts in the first hour.

## TL;DR

The foundations are better than most solo launches: **RLS is real and applied** (migrations 013–015, confirmed run and verified end-to-end in `SESSION_STATE.md`), the **service_role key was never committed** (git history clean), the anon key is the new **publishable** format, `npm audit` is **0 vulnerabilities**, and there are **no Supabase Storage buckets** to misconfigure (card art hotlinks Scryfall's CDN). No client-side admin/feature gates to bypass.

The real exposures are: (1) **anyone can rewrite the entire shared `cards` table** with only the anon key — trivial, scriptable, affects every user; (2) **zero rate limiting** on any anonymous path; (3) a **latent client-side Anthropic API key** pattern that's currently dead code but one wire-up away from leaking; and (4) **MTG/Apple compliance gaps** (no Scryfall attribution, no Fan Content notice, no in-app account deletion) that the community and App Review will both check.

### What I could NOT verify (you must confirm manually)
- **Live Supabase policy state.** I read the migration SQL, not the live database. `SESSION_STATE.md` says 013–015 were run and RLS was verified via REST probes on 2026-07-03, which is strong evidence — but a policy could have been toggled since. **Manual check below (Finding H1 / verification appendix).**
- **Vercel env var contents.** I can't see the Vercel dashboard. I verified no secrets ship in `dist/`, but you must confirm `VITE_ANTHROPIC_API_KEY` is **not** set in Vercel (Finding H2) and that the service key lives only in serverless env.

---

## CRITICAL — blocks the Reddit post

*None that are strictly account-takeover or secret-exfiltration.* The item closest to critical is H1 below — I've filed it HIGH because it's shared-data integrity, not data theft, but its blast radius (every user, trivially scriptable) means **treat it as launch-blocking.** Read H1 first.

---

## HIGH — fix before the post / before App Store

### H1 — The shared `cards` table is world-writable by any anonymous visitor (cache poisoning / defacement)
**Where:** `magikdex/supabase/migrations/013_multi_user.sql:627-630`
```sql
create policy cards_insert on cards for insert to authenticated with check (true);
create policy cards_update on cards for update to authenticated using (true) with check (true);
```
**Why it exists:** the app's cache-on-miss write-back (`writeBackToCache`, `magikdex/src/lib/scryfall.js`) upserts freshly-fetched Scryfall cards so the next lookup is instant. That needs client write access to `cards`.

**The exploit:** every visitor is auto-signed-in anonymously (`src/App.jsx` → `signInAnonymously()`), and an anonymous Supabase user has the **`authenticated`** role. So `to authenticated with check (true)` = *any human who opens the site.* With only the anon key (it's in the bundle) and one `signInAnonymously` call, an attacker can:
```js
// overwrite EVERY card's image with an attacker-controlled URL
await supabase.from('cards').update({ image_normal: 'https://evil/x.png' }).neq('oracle_id','');
```
- Point `image_normal`/`art_crop` at arbitrary URLs → **every user is served attacker-controlled images** (shock content, phishing, tracking pixels) app-wide.
- Rewrite `oracle_text`, `name`, `type_line`, `cmc`, `color_identity` → corrupt the 38k-row gameplay cache for everyone until you re-ingest. `color_identity`/`legal_commander` corruption also breaks `brew_stack` output silently.
- No per-row ownership, no size/field bounds, no undo. One script, whole table, in seconds.

**The fix (defense in depth — do more than one):**
1. **Preferred: stop writing to `cards` from the client entirely.** The service-role ingest (`npm run ingest:cards`) is already the authoritative populate path; write-back is a nice-to-have. Drop the `cards_insert`/`cards_update` policies (clients keep `cards_read`), and either accept cache misses fall through to the live Scryfall API (they already do — `fetchCardIdentity` degrades gracefully) or move write-back behind a serverless function that uses the service key and validates the payload.
2. **If you keep client write-back:** scope it hard — a policy that only allows `insert` (never `update`) of rows whose `oracle_id` doesn't yet exist, or route write-back through an `/api/cache-card` function that validates the row shape and only accepts data it re-fetches from Scryfall itself (never client-supplied fields).
- **Who does it:** *you*, in the Supabase SQL editor (policy change) + me (code change to remove/replace `writeBackToCache` or add the function).

### H2 — Client-side Anthropic API key pattern (latent leak — dead code today, landmine tomorrow)
**Where:** `magikdex/src/services/brewPrompt.js:49`
```js
const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
// ...fetch('https://api.anthropic.com/v1/messages', { headers: { 'x-api-key': apiKey,
//    'anthropic-dangerous-direct-browser-access': 'true' } ...
```
**Status:** `getBrewQuery` is **not imported anywhere** (verified) and is correctly **absent from `dist/`** (tree-shaken). So there is **no live leak today.** I'm flagging it HIGH anyway because the pattern is fundamentally unsafe: any `VITE_`-prefixed var is inlined into the public bundle. The moment someone wires this function into a screen **and** sets `VITE_ANTHROPIC_API_KEY` in Vercel, your Anthropic key ships to every browser and gets scraped and billed within hours. The `anthropic-dangerous-direct-browser-access: true` header shows the intent was to call from the browser — don't.

**The fix:**
- Confirm `VITE_ANTHROPIC_API_KEY` is **not set** in Vercel (I can't see the dashboard — *you check*).
- If/when you enable AI brew, move the call to a serverless function (`api/brew.js`) that reads a **non-`VITE_`** `ANTHROPIC_API_KEY` from serverless env, and add rate limiting + auth (see H3). Until then, consider deleting `brewPrompt.js`/`getBrewQuery` so the landmine can't be stepped on by accident.
- **Who:** *you* (verify Vercel env) + me (move to function or delete when you decide).

### H3 — No rate limiting on any anonymous path
**Where:** everything reachable with the anon key or an unauthenticated request.
**The exploit:** in the first hour, a script can hammer:
- **`/api/deck`** (`magikdex/api/deck.js`) — unauthenticated, GET, proxies Moxfield/Archidekt. Edge-cached 300s per URL, but distinct deck IDs bypass the cache. Hammering it (a) burns Vercel function invocations = your bill, and (b) gets **your Vercel egress IP flagged by Moxfield's Cloudflare** — the code's own comments record this already happening. That would break real users' imports.
- **`brew_stack` / `tag_stack` RPCs** — `EXECUTE` defaults to public (anon-callable), and they join `cards` × `card_tags` × `legend_synergy` (856k rows). Cheap to call, not cheap to run. A loop of `supabase.rpc('brew_stack', …)` with random color identities is a Supabase-compute drain.
- **`cards` writes** (H1) and anon reads generally.

**The fix (pick per surface):**
- `/api/deck`: add a lightweight per-IP limiter (Upstash Redis rate-limit, Vercel's `@vercel/functions` `ipAddress`, or even an in-memory token bucket for a start), and bound `req.query.url` length before regex. Keep the edge cache.
- RPCs: acceptable to leave public for launch, but watch Supabase compute; if abused, add a `SECURITY DEFINER` wrapper that checks `auth.role() = 'authenticated'` so at least a session is required, or move behind a rate-limited function.
- Enable Supabase's built-in **Auth rate limits** and consider Cloudflare/Vercel WAF in front.
- **Who:** me (code) + *you* (provision Upstash/WAF if you want durable limits; Vercel dashboard for WAF).

### H4 — No in-app account/data deletion (App Store 5.1.1(v) blocker)
**Where:** absent — `grep` for any delete-account/data path in `src` returns nothing.
**Why it matters:** decks/legends are stored server-side keyed to the anonymous `user_id`. Apple Guideline **5.1.1(v)** requires that any app supporting account creation also offer **in-app account deletion**. Anonymous accounts are a gray area, but App Review frequently flags them, and here real user content is retained server-side, so a deletion path is the safe read. This is a **submission blocker**, not a launch blocker for the web post.
**The fix:** add a Settings action "Delete my data" that deletes the user's `legends`/`decks` (cascades handle `deck_cards`/`deck_card_tags`) and calls `supabase.auth.signOut()` — plus, ideally, a serverless function using the service key to hard-delete the anon auth user (`auth.admin.deleteUser`). A privacy policy page is also required for a paid app with accounts.
- **Who:** me (Settings UI + delete function) + *you* (host a privacy policy URL; App Store Connect data-collection disclosure).

---

## MEDIUM — fix soon, not post-blocking

### M1 — Scryfall User-Agent is silently dropped in the browser (and is stale)
**Where:** `magikdex/src/lib/scryfall.js:3` — `const UA = "DeckStack/1.0 (deck-stack.vercel.app)";` set on every client `fetch` via `headers: { "User-Agent": UA }`.
**The problem:** `User-Agent` is a **forbidden header name** — browsers silently strip it from `fetch`. So **every client-side Scryfall call goes out with the default browser UA**, not your polite identifier. Scryfall's guidelines explicitly ask for a descriptive User-Agent; a hostile reader who inspects the network tab will see you're not sending one. (The Node ingest scripts *do* send it — those are fine.) The string is also stale — "DeckStack" / "deck-stack.vercel.app" is the old app identity, now magikdex/magikdex.vercel.app.
**Mitigating good news:** your **caching is genuinely good** — cache-first reads from the `cards` table, memoization, in-flight de-dupe, and a serialized 100ms politeness delay on live named lookups (`serializeNamedFetch`). That's the citizenship thing Scryfall cares about most, and you're doing it right. Card art hotlinks Scryfall's CDN image URLs directly (unaltered — noted in `SwipeScreen.jsx:773`, `ReviewScreen.jsx:879`), which is within their terms as long as you're not proxying/hammering, and the cache means you aren't.
**The fix:** you can't set UA from the browser, so either (a) accept it and just fix the string for the Node scripts + move any high-volume Scryfall traffic server-side where the UA sticks, or (b) proxy the few live Scryfall calls through a serverless function that sets a correct UA (weigh against Scryfall's "don't proxy" preference — probably not worth it given the cache). At minimum, update the UA string to the current app/domain.
- **Who:** me.

### M2 — No Scryfall attribution in the UI
**Where:** absent — only code comments reference Scryfall; no visible credit in-app or in `README.md`.
**Why it matters:** Scryfall asks that apps using their data/images credit Scryfall and note that data is from Scryfall (and that prices/art are theirs). The MTG community *will* look for this. It's cheap goodwill and expected.
**The fix:** add a footer / About / Settings line: "Card data and images © Scryfall. This product is not affiliated with Scryfall." Link to scryfall.com.
- **Who:** me (small UI addition).

### M3 — No Wizards of the Coast Fan Content Policy notice
**Where:** absent.
**Why it matters:** any public MTG app is expected to carry the Fan Content Policy disclaimer, and App Review/WotC-adjacent scrutiny expects it. `SESSION_STATE.md` already lists "Fan Content disclaimer" as a Phase 3 store task — bringing it forward for the web launch is prudent.
**The fix:** add to footer/About: *"magikdex is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC."*
- **Who:** me.

---

## LOW / HYGIENE

### L1 — `/api/deck` returns `Access-Control-Allow-Origin: *`
**Where:** `magikdex/api/deck.js` (default export). **Assessment: acceptable as-is.** It's GET-only, read-only, returns public deck data, and needs `*` so the Capacitor shell (`capacitor://localhost`) and Vite dev server can call it. `*` on a *write* endpoint would be a finding; on this read-only proxy it isn't. The real risk here is rate limiting (H3), not CORS. No change needed beyond H3.

### L2 — Leftover debug `console.log` in import flow
**Where:** `magikdex/src/brew-components/ImportSheet.jsx:135,144,146,171,249`, `PileScreen.jsx:75`, `settings.js:24`.
**Assessment:** benign — they log Moxfield import diagnostics and counts, **no secrets or PII**. Pure noise in the production console. Clean them up for polish; not a security issue.

### L3 — Stale branding in code strings
**Where:** `src/services/brewPrompt.js:1` (system prompt says "Cardstock"), `src/lib/scryfall.js:3` (UA says "DeckStack"). Cosmetic; fold into M1 / the brewPrompt decision.

### L4 — `Info.plist` missing `ITSAppUsesNonExemptEncryption`
**Where:** `magikdex/ios/App/App/Info.plist`.
**Why:** without `ITSAppUsesNonExemptEncryption = NO`, App Store Connect prompts about export compliance on every submission. You only use standard HTTPS (exempt). Add the key to skip the prompt. Not security-relevant.
- **Who:** me (one plist key).

### L5 — Local `.env` holds the live service key (correctly gitignored)
**Where:** `magikdex/.env` — contains `SUPABASE_SERVICE_KEY` (real service_role JWT), plus `VITE_SUPABASE_URL` and the publishable anon key.
**Assessment: not a leak.** `.gitignore` covers `.env` and `.env.*`, and git history confirms it was **never committed** (I scanned `git log -p --all` — only doc/comment *references* to the key name appear, never the value). The service key correctly has **no `VITE_` prefix**, so Vite can't bundle it, and it's absent from `dist/`. This is the intended setup for the ingest scripts. Just be aware the file sits in your working tree — don't ever `git add -f` it, and if you rotate keys, update it here too.

---

## Positive confirmations (things you got right)

- **RLS is applied and real,** not `USING (true)` theater, for user data: `legends`/`decks` scope to `user_id = auth.uid()`; `deck_cards`/`deck_card_tags` derive ownership via joins (`013_multi_user.sql:584-620`). Unauthenticated (`anon` role, no session) requests get **default-deny** on all user tables (no policy for that role).
- **Deck/legend IDs are UUIDs** (`gen_random_uuid()`), not sequential — **not enumerable.** Combined with RLS, one user cannot read/modify another's decks via direct API calls. I traced the `brew_stack` `p_deck_id` path: because the function is `SECURITY INVOKER` and `deck_cards` has RLS, passing someone else's `deck_id` leaks nothing — the caller only sees their own rows, so the exclusion just no-ops. No cross-user read.
- **Service role key never committed** (full-history scan clean) and **never bundled** (no `VITE_` prefix, absent from `dist/`).
- **Anon key is the publishable format** (`sb_publishable_…`) — designed to be public, independently rotatable. Correct.
- **No Supabase Storage buckets** — nothing to leave public by accident.
- **`npm audit`: 0 vulnerabilities.** Dependencies current (React 19, Vite 8, Supabase-js 2.107, Capacitor 8).
- **No client-side security theater** — no admin/`isAdmin`/feature-flag gates enforced only in the browser.
- **Capacitor config is clean** — no `server.url` pointing at a dev/live-reload host, no `allowNavigation` widening, iOS ATS not weakened, Android requests only `INTERNET`. No native permissions handed to web content.
- **No tracking / ATT needed** — no analytics SDK, so no `NSUserTrackingUsageDescription` requirement (as long as you add none).
- **`/api/deck` is not a general SSRF** — the URL is regex-constrained to moxfield.com/archidekt.com deck paths; it can't be pointed at internal hosts. Errors return generic messages, no stack traces or internal paths leaked.

---

## Recommended fix order

**Before the Reddit post (do these first):**
1. **H1 — lock down `cards` writes.** *You* run the policy change in Supabase SQL editor; *I* remove/replace client `writeBackToCache`. Highest blast radius, trivial to exploit.
2. **H3 — rate-limit `/api/deck`** (and bound the `url` param). *I* do the code; *you* provision Upstash/WAF if you want durable per-IP limits.
3. **H2 — confirm `VITE_ANTHROPIC_API_KEY` is not set in Vercel** (*you*), and delete or defer `brewPrompt.js` (*I*).
4. **M2 + M3 — add Scryfall attribution + Fan Content notice** to a footer/About. *I* do it; quick, and the community checks immediately.
5. **M1/L3 — fix the UA string** (and decide browser-UA is unfixable). *I* do it.

**Before App Store submission:**
6. **H4 — in-app account/data deletion** + privacy policy page. *I* build the UI/function; *you* host the policy URL and fill App Store Connect data disclosures.
7. **L4 — add `ITSAppUsesNonExemptEncryption = NO`** to Info.plist. *I* do it.

**Polish (anytime):**
8. **L2 — strip debug `console.log`s.** *I* do it.

### Split by who acts
- **I can do directly (code):** H1 client-side, H2 delete/defer, H3 limiter + input bound, H4 UI + delete function, M1/M2/M3, L2, L3, L4.
- **You must do (dashboards / external):**
  - Supabase SQL editor — H1 policy change (drop/replace `cards_insert`/`cards_update`); optional RPC role check for H3.
  - Vercel dashboard — confirm `VITE_ANTHROPIC_API_KEY` unset (H2); confirm service key is serverless-only; optional WAF (H3).
  - Provision Upstash Redis or similar if you want durable rate limiting (H3).
  - Host a privacy policy URL; App Store Connect data-collection disclosure (H4).
  - **Key rotation:** none required — nothing leaked. *If* you ever suspect the service key was exposed, rotation (Supabase → Settings → API → roll `service_role`) is the fix, **not** deleting the file.

### Manual verification appendix — confirm live RLS (5 min, do once before launch)
I read migration SQL, not the live DB. To confirm the live state matches:
1. In Supabase → **Authentication → Policies**, verify RLS is **enabled** on `legends`, `decks`, `deck_cards`, `deck_card_tags`, `cards`, `card_tags`, `legend_synergy`, `legend_themes`.
2. From a browser console on the live site (before H1 is fixed), prove the exposure and the protections:
   ```js
   // should FAIL / return no rows for another user's data (RLS working):
   await supabase.from('decks').select('*')   // returns only YOUR decks
   // should SUCCEED today (the H1 hole) — this is what you're closing:
   await supabase.from('cards').update({ oracle_text: 'test' }).eq('name','Sol Ring')
   ```
   After H1 is fixed, the second call must return an RLS error.
