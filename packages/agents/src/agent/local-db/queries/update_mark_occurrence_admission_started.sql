UPDATE kodama_scheduled_occurrences
SET admission_started = 1
WHERE id = :id AND state IN ('dispatching', 'submitted');
