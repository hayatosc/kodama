UPDATE kodama_scheduled_tasks
SET state = 'cancelled', next_due = NULL
WHERE id = :id;
