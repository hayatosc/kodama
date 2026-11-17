UPDATE mcp_oauth_clients
SET
  status = 'ready',
  metadata_json = :metadataJson,
  secret_id = :secretId
WHERE registration_id = :registrationId;
