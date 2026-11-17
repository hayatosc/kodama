SELECT MAX(last_entry) AS last
FROM kodama_prune_runs
WHERE state = 'deleted';
