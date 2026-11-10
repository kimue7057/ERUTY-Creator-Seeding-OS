-- Run as owner only after migration 0018. The runtime must not own tables.
GRANT SELECT, INSERT, UPDATE ON outreach_sender_accounts, outreach_oauth_states, outreach_drafts TO eruty_seeding_app;
GRANT SELECT, INSERT, UPDATE ON outreach_provider_apps, outreach_brand_settings, outreach_templates TO eruty_seeding_app;
GRANT SELECT, INSERT, UPDATE ON outreach_connection_tests TO eruty_seeding_app;
