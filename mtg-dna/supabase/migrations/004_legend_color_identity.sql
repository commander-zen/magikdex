-- 004_legend_color_identity.sql — color identity for brew auto-seeding
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).

alter table legends add column if not exists color_identity text[];
