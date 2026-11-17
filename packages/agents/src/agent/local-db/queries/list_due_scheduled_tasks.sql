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
WHERE t.state = 'active'
  AND t.next_due <= :now
  AND NOT EXISTS (
    SELECT 1
    FROM kodama_scheduled_occurrences AS o
    WHERE o.task_id = t.id AND o.state IN ('dispatching', 'submitted')
  )
ORDER BY t.next_due ASC, t.id ASC
LIMIT 10;
