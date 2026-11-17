UPDATE kodama_usage
SET aggregated_at = :now
WHERE seq <= :through AND aggregated_at IS NULL;
