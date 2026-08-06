-- 003_legend_identity.sql — Scryfall identity columns for legends
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).

alter table legends add column if not exists type_line text;
alter table legends add column if not exists oracle_text text;
alter table legends add column if not exists mana_cost text;
