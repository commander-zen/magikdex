-- 038_rule0_legends.sql — rule 0 commanders that aren't (yet) Scryfall cards
--
-- ✅ APPLIED TO PRODUCTION 2026-11-17 (additive; every existing row reads
-- false), then `notify pgrst, 'reload schema'`.
--
-- Ben, 2026-11-17: a leaked card (Muad'Dib, Prophet Foretold) he wants to brew
-- before it's official, and table-agreed "rule 0" commanders that aren't legal
-- (incl. the pride-month "any two legends can partner" tradition).
--
-- A custom legend lives ONLY on the user's own legends row (name, type line,
-- oracle text, mana cost, colour identity, optional art URL). It never touches
-- the shared `cards` table, so that table stays a pure mirror of Scryfall.
--
-- `custom = true` is what tells the client to keep its hands off the row:
-- every "heal this legend's identity by name" path does a FUZZY Scryfall
-- lookup, which would overwrite a leak with whatever real card is nearest.
--
-- Scope: one column on public.legends. No policy or grant change — the
-- legends ownership policy (001/024) is column-agnostic.

alter table public.legends
  add column if not exists custom boolean not null default false;

comment on column public.legends.custom is
  'Rule 0 / unreleased commander typed in by the user. Not a Scryfall card: the client must never heal or re-resolve it by name.';
