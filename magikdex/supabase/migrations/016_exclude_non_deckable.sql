-- 016_exclude_non_deckable.sql — purge non-deckable cards + guard the stacks
-- Run manually in the Supabase SQL editor (this project has no CLI migration
-- history — same posture as every migration here).
--
-- Change 8 (v3 UAT): a Llanowar Elves TOKEN reached a real deck and the swipe
-- stack. Root cause: ingest-cards.mjs loaded the oracle_cards bulk with no
-- layout filter, so token / double-faced-token / emblem / Art Series objects
-- landed in `cards`. A token sharing a name with a real card (name collision)
-- then won getCardDataBatch's last-row-wins race, so the deck/review rendered
-- the token. ingest-cards.mjs now skips these at load time; this migration
-- (a) purges any already-ingested non-deckables and (b) adds a layout guard to
-- both stack RPCs so a future un-filtered ingest still can't deal one.
--
-- The `cards` table stores `layout` but NOT `set_type`, so the purge keys on
-- layout alone (the in-code ingest filter also checks set_type = 'token').
-- Layout values verified against scryfall.com/docs/api/layouts.

-- ── (a) Purge ────────────────────────────────────────────────────────────────
delete from cards
where layout in ('token', 'double_faced_token', 'emblem', 'art_series');

-- ── (b) brew_stack — same body as 015, plus the non-deckable layout guard ────
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
$$;

-- ── (b) tag_stack — same body as 012, plus the non-deckable layout guard ─────
create or replace function tag_stack(
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
    and coalesce(c.layout, '') not in ('token', 'double_faced_token', 'emblem', 'art_series')
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$$;
