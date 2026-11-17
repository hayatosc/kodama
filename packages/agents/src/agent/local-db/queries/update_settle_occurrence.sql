UPDATE kodama_scheduled_occurrences
SET state = :state, outcome = :outcome, settled_at = :settledAt
WHERE id = :id AND state IN ('dispatching', 'submitted')
RETURNING task_id AS taskId;
