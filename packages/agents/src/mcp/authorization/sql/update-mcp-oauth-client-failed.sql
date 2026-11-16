UPDATE mcp_oauth_clients
SET status = 'reauth_required'
WHERE registration_id = :registrationId;
