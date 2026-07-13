-- 012_theme_weight_tag_stack.sql — theme-weighted brew_stack + category stacks
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- Ben's 2026-07-02 follow-ups:
--  1. Theme→otag weighting (approved, design delegated): "the standard is
--     tags, and then if that tag is on the legends EDHREC page it is
--     weighted." brew_stack v3 boosts a tag match when the matched tag maps
--     to one of the legend's TOP FIVE EDHREC themes (legend_themes, 011) —
--     top five because broad commanders carry 90+ themes (Cap: 93) and an
--     unranked boost would hit nearly everything. Boost = 5−rank (theme #1
--     → 5 … theme #5 → 1), max across the card's matched tags. Ordering:
--     synergy DESC (unchanged, EDHREC-page cards still lead) → theme_boost
--     DESC → global EDHREC rank.
--  2. WREC gap-filling ("veggies"): from the deck list, tapping a category
--     with a gap → "add more" → a swipe stack of that category's otag pool
--     in the commander's color identity, agnostic of the legend's plan or
--     EDHREC themes. That's tag_stack below — the client passes the
--     category's otags (the taxonomy's otag→WREC map, same file the ingest
--     uses), keeping the taxonomy in exactly one place.

-- ── brew_stack v3 ────────────────────────────────────────────────────────────
-- Return type gains `theme_boost`, so CREATE OR REPLACE can't be used.
drop function if exists brew_stack(text, text[], uuid, boolean, int);

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
  edhrec_rank integer, matched_tags text[], synergy numeric,
  theme_boost integer
)
language sql stable
as $$
  with legend_tags as (
    select ct.tag from card_tags ct
    where ct.oracle_id = p_legend_oracle_id
      and ct.source = 'tagger-card-page'
  ),
  -- The legend's top-5 EDHREC themes as otag slugs. Exact slug matches pass
  -- through; the VALUES table adds known EDHREC-slug → otag-slug aliases
  -- (every otag here is live-verified in scripts/otag-taxonomy.mjs — EDHREC
  -- theme slugs verified against legend_themes 2026-07-02). A theme with no
  -- otag counterpart simply never matches — no boost, no harm.
  themes as (
    select lt.theme_slug as otag, (5 - lt.rank)::int as boost
    from legend_themes lt
    where lt.legend_oracle_id = p_legend_oracle_id and lt.rank < 5
    union all
    select a.otag, (5 - lt.rank)::int
    from legend_themes lt
    join (values
      ('burn',                  'synergy-burn'),
      ('tokens',                'repeatable-token-generator'),
      ('aristocrats',           'sacrifice-outlet'),
      ('card-draw',             'card-advantage'),
      ('reanimator',            'reanimate'),
      ('spell-copy',            'copy'),
      ('clones',                'clone'),
      ('wheels',                'wheel'),
      ('anthems',               'anthem'),
      ('counterspells',         'counterspell'),
      ('extra-combats',         'extra-combat'),
      ('extra-turns',           'extra-turn'),
      ('plus-1-plus-1-counters','counters-matter')
    ) as a(theme_slug, otag) on a.theme_slug = lt.theme_slug
    where lt.legend_oracle_id = p_legend_oracle_id and lt.rank < 5
  ),
  tag_matches as (
    select ct.oracle_id,
           array_agg(ct.tag order by ct.tag) as matched_tags,
           max(t.boost) as theme_boost
    from card_tags ct
    join legend_tags lt on lt.tag = ct.tag
    left join themes t on t.otag = ct.tag
    group by ct.oracle_id
  ),
  syn as (
    select ls.name_lower, ls.synergy
    from legend_synergy ls
    where ls.legend_oracle_id = p_legend_oracle_id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags, s.synergy,
         m.theme_boost
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
  order by s.synergy desc nulls last, m.theme_boost desc nulls last,
           c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$$;

-- ── tag_stack — category gap-filling ─────────────────────────────────────────
-- Cards carrying ANY of the given otags, color-identity constrained,
-- commander-legal, global-EDHREC-rank ordered. Deliberately blind to the
-- legend's themes and synergy (per Ben: agnostic of the plan) — a ramp gap
-- wants the best ramp in these colors, full stop.
drop function if exists tag_stack(text[], text[], uuid, boolean, int);

create function tag_stack(
  p_tags           text[],
  p_color_identity text[],
  p_deck_id        uuid    default null,
  p_exclude_lands  boolean default true,
  p_limit          int     default 400
)
returns table (
  oracle_id text, scryfall_id text, name text, type_line text,
  oracle_text text, mana_cost text, cmc numeric, color_identity text[],
  layout text, card_faces jsonb, image_normal text, art_crop text,
  edhrec_rank integer, matched_tags text[]
)
language sql stable
as $$
  with tag_matches as (
    select ct.oracle_id, array_agg(ct.tag order by ct.tag) as matched_tags
    from card_tags ct
    where ct.tag = any(p_tags)
    group by ct.oracle_id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags
  from cards c
  join tag_matches m on m.oracle_id = c.oracle_id
  where c.color_identity <@ p_color_identity
    and coalesce(c.legal_commander, false)
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$$;

-- No RLS / grant block: matches the project's open-access posture; writes are
-- the ingest scripts, function EXECUTE defaults to public.
