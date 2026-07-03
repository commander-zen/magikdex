-- 014_claim_my_data.sql — one-time: attach Ben's pre-multi-user data to his
-- account. Run AFTER 013 and AFTER opening the app once on your main device
-- (the phone), which signs you in anonymously.
--
-- Get your user id from the app: Settings → the "account" row (tap to copy),
-- then replace the placeholder below and run. Until you do, your existing
-- legends/decks are invisible in the app (user_id NULL) but fully intact.

update legends set user_id = '<YOUR-USER-ID>' where user_id is null;
update decks   set user_id = '<YOUR-USER-ID>' where user_id is null;
