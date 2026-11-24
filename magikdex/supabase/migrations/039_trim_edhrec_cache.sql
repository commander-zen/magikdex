-- 039_trim_edhrec_cache.sql — shrink the shared EDHREC/Tagger cache
--
-- Ben, 2026-11-24: the DB sat at 412 MB of the 500 MB free tier, 266 MB of it
-- legend_synergy (884k rows). Every trim here removes data nothing reads;
-- the one behaviour change (step 1) is a bug fix.
--
-- 1. MDFC names. EDHREC names a modal double-faced card by its FRONT face
--    ("bala ged recovery"); cards.name_lower holds the full "a // b" name, so
--    brew_stack's name join silently dropped ~26.5k synergy rows (649 cards,
--    every MDFC land/spell). Rename them to the full name. Fronts that map to
--    two different cards (start → Start // Finish | Start // Fire) are left
--    alone. ingest-legend-edhrec.mjs now does the same mapping on write.
-- 2. Drop card_name / num_decks / potential_decks / source_list. brew_stack
--    reads legend_oracle_id, name_lower and synergy only; nothing else in
--    magikdex or deck-stats selects these. card_name was name_lower with caps.
-- 3. legend_oracle_id text → uuid on legend_synergy and legend_themes
--    (37 → 16 bytes per row, in the heap AND the PK index). Every existing
--    value was checked to be a well-formed uuid first. The type change
--    rewrites both tables, which also compacts them (no VACUUM FULL needed).
--    brew_stack keeps its `text` parameter (client + 024 grant test unchanged)
--    and casts once; deck-stats' REST `eq.` filter casts on its own.
-- 4. card_tags: delete Tagger trivia tags (now blocklisted in
--    otag-taxonomy.mjs) and tags whose card no longer exists in `cards`.
--
-- Run cards / card_tags VACUUM FULL separately afterwards (it can't run
-- inside a transaction).

begin;
-- the uuid rewrite of an ~880k-row table outlasts the default API timeout
set local statement_timeout = '10min';

-- 1 ── MDFC front-face names → full card names ────────────────────────────────
with dfc as (
  select split_part(name_lower, ' // ', 1) as front, min(name_lower) as full_name
  from public.cards
  where name_lower like '% // %'
  group by 1
  having count(distinct name_lower) = 1
)
update public.legend_synergy ls
   set name_lower = dfc.full_name
  from dfc
 where ls.name_lower = dfc.front;

-- 2 ── unused columns ──────────────────────────────────────────────────────────
alter table public.legend_synergy
  drop column card_name,
  drop column num_decks,
  drop column potential_decks,
  drop column source_list;

-- 3 ── uuid keys (rewrites + compacts both tables) ─────────────────────────────
alter table public.legend_synergy
  alter column legend_oracle_id type uuid using legend_oracle_id::uuid;
alter table public.legend_themes
  alter column legend_oracle_id type uuid using legend_oracle_id::uuid;

-- brew_stack body is unchanged except the legend id is cast to uuid once, in
-- `legend`, for the two cache tables (cards/card_tags keep text oracle ids).
create or replace function public.brew_stack(
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
  edhrec_rank integer, matched_tags text[], synergy numeric, theme_boost integer
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
    select ls.name_lower, ls.synergy
    from legend_synergy ls, legend
    where ls.legend_oracle_id = legend.id
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
    and coalesce(c.layout, '') not in ('token', 'double_faced_token', 'emblem', 'art_series')
    and c.oracle_id <> p_legend_oracle_id
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by s.synergy desc nulls last, m.theme_boost desc nulls last,
           c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$function$;

-- 4 ── card_tags junk ──────────────────────────────────────────────────────────
delete from public.card_tags
 where tag in ('anagram', 'vanity-card', 'fun-ruling', 'type-errata',
               'unique-type-line', 'deprecated-card-types', 'normal-human-name');

delete from public.card_tags ct
 where not exists (select 1 from public.cards c where c.oracle_id = ct.oracle_id);

commit;

-- 5 ── inclusion (applied right after the above, same day) ────────────────────
-- Synergy is NOT "top cards": ~1.0 means "played almost only here", which
-- surfaces niche picks. EDHREC's Top Cards list orders by inclusion
-- (num_decks / potential_decks). One real replaces the two dropped ints;
-- the ingest fills it. brew_stack does not read it yet.
alter table public.legend_synergy add column if not exists inclusion real;
comment on column public.legend_synergy.inclusion is 'EDHREC num_decks / potential_decks (0..1): share of this commander''s decks running the card — the order of EDHREC''s Top Cards list.';

notify pgrst, 'reload schema';
