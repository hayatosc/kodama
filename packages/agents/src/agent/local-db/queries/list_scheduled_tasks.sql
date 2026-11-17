WITH input AS (
  SELECT
    :state::nullable(text) AS filter_state,
    :cursor::nullable(text) AS cursor_id
)
SELECT
  t.id,
  t.source_task AS sourceTask,
  t.source_entry AS sourceEntry,
  t.arguments,
  t.instruction,
  t.rule AS ruleJson,
  t.category,
  t.followup_hop AS followupHop,
  t.session_mode AS sessionMode,
  t.state,
  t.next_due AS nextDue,
  t.cursor,
  t.created_at AS createdAt
FROM kodama_scheduled_tasks AS t
CROSS JOIN input
WHERE (input.filter_state IS NULL OR t.state = input.filter_state)
  AND (input.cursor_id IS NULL OR t.id > input.cursor_id)
ORDER BY t.id ASC
LIMIT 51;
