WITH input AS (
  SELECT :failed::integer AS failed_flag
)
UPDATE kodama_scheduled_tasks
SET state = :state, next_due = NULL
WHERE id = :id
  AND state = 'active'
  AND ((SELECT failed_flag FROM input) != 0 OR next_due IS NULL);
