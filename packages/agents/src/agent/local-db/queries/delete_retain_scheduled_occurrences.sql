DELETE FROM kodama_scheduled_occurrences
WHERE state NOT IN ('dispatching', 'submitted') AND settled_at <= :before;
