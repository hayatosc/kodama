DELETE FROM kodama_usage
WHERE aggregated_at < :before;
