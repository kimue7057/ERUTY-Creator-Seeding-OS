-- Owner applies after migration 0009. Existing Discovery MCP role gets no new rights.
GRANT SELECT,INSERT ON creator_evaluations,creator_evaluation_reviews,evaluation_requests TO eruty_discovery_dashboard;
GRANT UPDATE(state,error_code,updated_at) ON evaluation_requests TO eruty_discovery_dashboard;
GRANT SELECT ON creator_evaluations,creator_evaluation_reviews,evaluation_requests TO eruty_discovery_verifier;
