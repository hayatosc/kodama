SELECT
  approval_id AS approvalId,
  tool_name AS toolName,
  tool_digest AS toolDigest
FROM kodama_deferred_calls
WHERE state IN ('pending', 'approved')
  AND (
    tool_digest IS NOT NULL
    OR (tool_name LIKE 'mcp_%' AND tool_name != 'mcp_registration')
  );
