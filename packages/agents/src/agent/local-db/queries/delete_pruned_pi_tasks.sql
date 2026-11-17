DELETE FROM tasks
WHERE status = 'terminal'
  AND NOT EXISTS (
    SELECT 1
    FROM kodama_mcp_calls AS c
    WHERE c.call_id = CAST(tasks.id AS TEXT)
  );
