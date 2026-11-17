UPDATE kodama_scheduled_tasks
SET followup_hop = :followupHop, rule = :rule, next_due = :nextDue
WHERE id = :id;
