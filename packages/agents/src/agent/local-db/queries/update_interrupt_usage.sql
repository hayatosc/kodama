UPDATE kodama_usage
SET status = 'interrupted', usage_state = 'unknown', finished_at = :finishedAt
WHERE status = 'in_flight';
