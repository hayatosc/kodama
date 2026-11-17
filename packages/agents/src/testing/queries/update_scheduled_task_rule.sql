UPDATE kodama_scheduled_tasks
SET rule = :rule, next_due = :nextDue
WHERE id = :id;
