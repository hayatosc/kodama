INSERT INTO mcp_tools (
  tool_id,
  server_id,
  remote_name,
  model_name,
  server_revision,
  digest,
  definition_json,
  rejection,
  present
)
VALUES (
  :toolId,
  :serverId,
  :remoteName,
  :modelName,
  :serverRevision,
  :digest,
  :definitionJson,
  :rejection::nullable(text),
  :present
)
ON CONFLICT (tool_id) DO UPDATE SET
  server_id = excluded.server_id,
  remote_name = excluded.remote_name,
  model_name = excluded.model_name,
  server_revision = excluded.server_revision,
  digest = excluded.digest,
  definition_json = excluded.definition_json,
  rejection = excluded.rejection,
  present = excluded.present;
