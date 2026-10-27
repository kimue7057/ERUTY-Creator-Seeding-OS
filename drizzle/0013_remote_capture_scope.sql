ALTER TABLE discovery_browser_requests ADD CONSTRAINT browser_request_capture_scope UNIQUE(organization_id,id,run_id);
ALTER TABLE discovery_browser_captures ADD CONSTRAINT browser_capture_request_scope FOREIGN KEY(organization_id,request_id,run_id) REFERENCES discovery_browser_requests(organization_id,id,run_id);
ALTER TABLE discovery_browser_sessions ADD CONSTRAINT browser_session_hash CHECK(token_hash ~ '^[a-f0-9]{64}$');
