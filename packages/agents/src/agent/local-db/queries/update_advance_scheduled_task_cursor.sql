UPDATE kodama_scheduled_tasks
SET cursor = :cursor, next_due = :nextDue
WHERE id = :id;
