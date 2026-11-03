-- Run as owner only after migration 0016. The runtime must not own tables.
GRANT SELECT, INSERT, UPDATE ON outreach_sender_accounts, outreach_oauth_states, outreach_drafts TO eruty_seeding_app;
