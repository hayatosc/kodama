WITH input AS (
  SELECT :serverId::nullable(text) AS serverId
)
SELECT DISTINCT
  mcp_assignments.agent_id AS agentId,
  mcp_assignments.server_id AS serverId
FROM mcp_assignments, input
WHERE (input.serverId IS NULL OR mcp_assignments.server_id = input.serverId);
