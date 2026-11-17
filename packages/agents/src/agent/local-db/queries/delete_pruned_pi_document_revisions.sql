DELETE FROM document_revisions
WHERE document_id IN (
  SELECT d.id
  FROM documents AS d
  WHERE d.scope_kind = 'task'
    AND d.owner_id IN (
      SELECT t.id
      FROM tasks AS t
      WHERE t.status = 'terminal'
        AND NOT EXISTS (
          SELECT 1
          FROM kodama_mcp_calls AS c
          WHERE c.call_id = CAST(t.id AS TEXT)
        )
    )
);
