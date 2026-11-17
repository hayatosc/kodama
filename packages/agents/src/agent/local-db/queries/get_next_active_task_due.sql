SELECT t.next_due AS at
FROM kodama_scheduled_tasks AS t
WHERE t.state = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM kodama_scheduled_occurrences AS o
    WHERE o.task_id = t.id AND o.state IN ('dispatching', 'submitted')
  )
ORDER BY t.next_due ASC
LIMIT 1;
