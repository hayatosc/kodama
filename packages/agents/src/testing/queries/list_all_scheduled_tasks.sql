SELECT
  id,
  source_task AS sourceTask,
  source_entry AS sourceEntry,
  arguments,
  instruction,
  rule,
  category,
  followup_hop AS followupHop,
  session_mode AS sessionMode,
  state,
  next_due AS nextDue,
  cursor,
  created_at AS createdAt
FROM kodama_scheduled_tasks
ORDER BY created_at ASC, id ASC;
