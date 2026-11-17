SELECT id
FROM kodama_scheduled_occurrences
WHERE task_id = :taskId AND state IN ('dispatching', 'submitted')
LIMIT 1;
