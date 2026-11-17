SELECT
  id,
  source_task AS sourceTask,
  source_entry AS sourceEntry,
  arguments,
  instruction,
  rule AS ruleJson,
  category,
  followup_hop AS followupHop,
  session_mode AS sessionMode,
  state,
  next_due AS nextDue,
  cursor,
  created_at AS createdAt
FROM kodama_scheduled_tasks
WHERE source_task = :sourceTask;
