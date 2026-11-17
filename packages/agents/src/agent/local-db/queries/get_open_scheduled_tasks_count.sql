SELECT COUNT(*) AS value
FROM kodama_scheduled_tasks
WHERE state IN ('active', 'paused')
   OR id IN (
     SELECT task_id
     FROM kodama_scheduled_occurrences
     WHERE state IN ('dispatching', 'submitted')
   );
