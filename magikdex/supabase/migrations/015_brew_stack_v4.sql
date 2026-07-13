-- 015_brew_stack_v4.sql — relevance for EVERY commander, not just curated ones
-- Run manually in the Supabase SQL editor.
--
-- Ben 2026-07-03: "only Hawkeye works right. I need this functionality to be
-- correct for every card in the game that could possibly be a commander" —
-- any un-ingested legend fell back to the generic EDHREC-rank stack
-- ("sol ring, arcane signet…"), instant product death for a Commander player.
--
-- v3's pool needed a per-legend Tagger-page profile (card_tags rows with
-- source 'tagger-card-page') — hand-ingested, three legends had one. v4
-- widens the pool source: the legend's TOP-5 EDHREC THEMES map to otags and
-- join the pool alongside any Tagger profile. With the EDHREC bulk ingest
-- (`npm run ingest:legend-edhrec -- --all`, same release) every commander
-- with an EDHREC page gets: synergy cards first, theme-tag matches next
-- (boosted), broad tag matches last. Tagger profiles remain a per-legend
-- enrichment, no longer a requirement.
--
-- Same signature/return type as v3 — CREATE OR REPLACE is fine.

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
  edhrec_rank integer, matched_tags text[], synergy numeric,
  theme_boost integer
)
language sql stable
as $$
  with themes as (
    -- top-5 EDHREC themes as otag slugs: exact matches pass through, plus
    -- the verified EDHREC-slug → otag-slug aliases (see 012 for provenance)
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
  -- v4: the pool's tag set = Tagger-page profile (when one exists) ∪ the
  -- theme-derived otags — so an EDHREC page alone is enough for relevance.
  legend_tags as (
    select ct.tag from card_tags ct
    where ct.oracle_id = p_legend_oracle_id
      and ct.source = 'tagger-card-page'
    union
    select t.otag from themes t
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
