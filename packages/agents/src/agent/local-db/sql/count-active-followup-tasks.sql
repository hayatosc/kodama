SELECT COUNT(*) AS value
FROM kodama_scheduled_tasks
WHERE category = 'followup' AND state = 'active';
