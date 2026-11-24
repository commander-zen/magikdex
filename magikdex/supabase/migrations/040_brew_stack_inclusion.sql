-- 040_brew_stack_inclusion.sql — quick brew deals EDHREC's TOP CARDS first
--
-- Ben, 2026-11-24: "my intention is to have the quick brew ability spit out
-- the top EDHREC cards". brew_stack ranked by EDHREC *synergy*, and synergy
-- ≈1.0 means "played almost only with this commander", so it led with niche
-- picks (Rocksteady: Wildgrowth Archaic, Knight of Wundagore, Mister Hyde).
-- EDHREC's own Top Cards list orders by INCLUSION, the share of this
-- commander's decks running the card (Meren: Sol Ring 85%, Sakura-Tribe Elder
-- 83%, Spore Frog 75%, Eternal Witness 74%). legend_synergy.inclusion was
-- added in 039 and filled by the 2026-11-24 --all ingest.
--
-- New order: inclusion → synergy → theme_boost → global edhrec_rank.
-- Tag-only matches (no EDHREC row) still trail, as before.
--
-- The return type gains `inclusion` (the client's local re-sort needs it), so
-- this is drop + create, not create-or-replace. Same signature, same pinned
-- search_path (024's test 8 still holds), same default EXECUTE grants.

begin;

drop function if exists public.brew_stack(text, text[], uuid, boolean, integer);

create function public.brew_stack(
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
  edhrec_rank integer, matched_tags text[], synergy numeric, theme_boost integer,
  inclusion real
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with legend as (
    select p_legend_oracle_id::uuid as id
  ),
  themes as (
    select lt.theme_slug as otag, (5 - lt.rank)::int as boost
    from legend_themes lt, legend
    where lt.legend_oracle_id = legend.id and lt.rank < 5
    union all
    select a.otag, (5 - lt.rank)::int
    from legend_themes lt
    cross join legend
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
    where lt.legend_oracle_id = legend.id and lt.rank < 5
  ),
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
    select ls.name_lower, ls.synergy, ls.inclusion
    from legend_synergy ls, legend
    where ls.legend_oracle_id = legend.id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags, s.synergy,
         m.theme_boost, s.inclusion
  from cards c
  left join tag_matches m on m.oracle_id = c.oracle_id
  left join syn s on s.name_lower = c.name_lower
  where (m.oracle_id is not null or s.name_lower is not null)
    and c.color_identity <@ p_color_identity
    and coalesce(c.legal_commander, false)
    and coalesce(c.layout, '') not in ('token', 'double_faced_token', 'emblem', 'art_series')
    and c.oracle_id <> p_legend_oracle_id
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by s.inclusion desc nulls last, s.synergy desc nulls last,
           m.theme_boost desc nulls last, c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$function$;

commit;

notify pgrst, 'reload schema';
