-- 010_brew_stack.sql — the brew stack query as a Postgres function
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- Why a function: card_tags deliberately has no FK to cards (009 — spoiler-
-- season ingest-order independence), so PostgREST can't embed across them,
-- and a legend's tag pool is 1,000+ oracle_ids — too many for an `in()`
-- filter in a URL. One RPC does the whole join server-side: cards in the
-- legend's color identity, sharing at least one of the legend's own
-- Tagger-page tags, commander-legal, EDHREC-rank ordered, minus the legend
-- itself and anything already in the deck.
--
-- App call: supabase.rpc("brew_stack", { p_legend_oracle_id, p_color_identity,
-- p_deck_id, p_exclude_lands, p_limit }).

-- The cards cache stored no legality data, but the oracle bulk file includes
-- un-sets, banned cards, and Alchemy rebalances — without this flag the stack
-- would deal illegal cards. Populated by re-running `npm run ingest:cards`
-- (rows stay null until then; the function treats null as not legal).
alter table cards add column if not exists legal_commander boolean;

create or replace function brew_stack(
  p_legend_oracle_id text,
  p_color_identity   text[],
  p_deck_id          uuid    default null,
  p_exclude_lands    boolean default true,
  p_limit            int     default 400
)
returns table (
  oracle_id text, scryfall_id text, name text, type_line text,
  oracle_text text, mana_cost text, cmc numeric, color_identity text[],
  layout text, card_faces jsonb, image_normal text, art_crop text,
  edhrec_rank integer, matched_tags text[]
)
language sql stable
as $$
  with legend_tags as (
    -- the legend's OWN Tagger-page profile, not the whole taxonomy
    select ct.tag from card_tags ct
    where ct.oracle_id = p_legend_oracle_id
      and ct.source = 'tagger-card-page'
  ),
  matches as (
    -- matched_tags rides along so the UI (and B.I.L.L. later) can say WHY a
    -- card is in the stack
    select ct.oracle_id, array_agg(ct.tag order by ct.tag) as matched_tags
    from card_tags ct
    join legend_tags lt on lt.tag = ct.tag
    group by ct.oracle_id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags
  from cards c
  join matches m on m.oracle_id = c.oracle_id
  where c.color_identity <@ p_color_identity
    and coalesce(c.legal_commander, false)
    and c.oracle_id <> p_legend_oracle_id
    -- \y = word boundary: matches the Land TYPE on either face ("Basic Land —
    -- Island", "Sorcery // Land") without substring false-positives
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by c.edhrec_rank nulls last, c.name
  limit p_limit;
$$;

-- No grant block: function EXECUTE defaults to public, matching the project's
-- open-access posture (read-only over reference data).
