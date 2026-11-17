UPDATE kodama_scheduled_tasks
SET
  state = :state,
  instruction = :instruction,
  rule = :ruleJson,
  next_due = :nextDue,
  cursor = :cursor,
  session_mode = :sessionMode,
  followup_hop = :followupHop
WHERE id = :id
RETURNING
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
  created_at AS createdAt;
