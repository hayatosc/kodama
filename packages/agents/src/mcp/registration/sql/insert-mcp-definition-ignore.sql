INSERT INTO mcp_definitions (digest, definition_json)
VALUES (:digest, :definitionJson)
ON CONFLICT (digest) DO NOTHING;
