-- 011_legend_edhrec.sql — per-legend EDHREC cache + synergy-first brew_stack
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- Ben's 2026-07-02 stack verdict: shared otags alone match the wrong CONTEXT
-- (Hawkeye carries power-matters because she wants her own power raised — a
-- burn commander — yet Altar of Dementia led her stack), and none of her
-- EDHREC high-synergy cards were on top. Fix: cache each legend's EDHREC
-- commander-page data (synergy card lists + theme tags — Ben approved the
-- unofficial JSON feed) and let brew_stack rank synergy first. Tag-only
-- matches stay in the stack but trail, ordered by global EDHREC rank.

-- One row per (legend, card) from the commander page's cardlists (High
-- Synergy Cards, Top Cards, per-type lists). name_lower is the join key into
-- cards — EDHREC gives names, not oracle ids. No FK to cards for the same
-- ingest-order reason as card_tags (009).
create table if not exists legend_synergy (
  legend_oracle_id text not null,
  card_name        text not null,
  name_lower       text not null,
  -- EDHREC's synergy score (-1..1): how specific this card is to THIS
  -- commander vs the format at large. The stack's primary sort key.
  synergy          numeric,
  num_decks        integer,
  potential_decks  integer,
  -- which cardlist the row first appeared in (highsynergycards, topcards, …)
  source_list      text,
  updated_at       timestamptz not null default now(),
  primary key (legend_oracle_id, name_lower)
);

-- The commander page's theme tags (panels.taglinks), rank-ordered — the
-- "main theme" signal (Hawkeye: Burn 13, Spellslinger 7, …). Stored for
-- display and future theme→otag weighting; not yet consumed by brew_stack.
create table if not exists legend_themes (
  legend_oracle_id text not null,
  theme_slug       text not null,
  theme_name       text,
  deck_count       integer,
  rank             smallint not null,
  updated_at       timestamptz not null default now(),
  primary key (legend_oracle_id, theme_slug)
);

-- Return type gains `synergy`, so CREATE OR REPLACE can't be used.
drop function if exists brew_stack(text, text[], uuid, boolean, int);

-- v2: the pool is (cards sharing the legend's Tagger-page tags) ∪ (the
-- legend's EDHREC-page cards); EDHREC-listed cards rank first by synergy,
-- tag-only matches trail by global EDHREC rank.
create function brew_stack(
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
  edhrec_rank integer, matched_tags text[], synergy numeric
)
language sql stable
as $$
  with legend_tags as (
    select ct.tag from card_tags ct
    where ct.oracle_id = p_legend_oracle_id
      and ct.source = 'tagger-card-page'
  ),
  tag_matches as (
    select ct.oracle_id, array_agg(ct.tag order by ct.tag) as matched_tags
    from card_tags ct
    join legend_tags lt on lt.tag = ct.tag
    group by ct.oracle_id
  ),
  syn as (
    select ls.name_lower, ls.synergy
    from legend_synergy ls
    where ls.legend_oracle_id = p_legend_oracle_id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags, s.synergy
  from cards c
  left join tag_matches m on m.oracle_id = c.oracle_id
  left join syn s on s.name_lower = c.name_lower
  where (m.oracle_id is not null or s.name_lower is not null)
    and c.color_identity <@ p_color_identity
    and coalesce(c.legal_commander, false)
    and c.oracle_id <> p_legend_oracle_id
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by s.synergy desc nulls last, c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$$;

-- No RLS / grant block: matches the project's open-access posture; writes are
-- the ingest scripts, function EXECUTE defaults to public.
