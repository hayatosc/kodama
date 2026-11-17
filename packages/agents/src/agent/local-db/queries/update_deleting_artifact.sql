UPDATE kodama_artifacts
SET state = 'deleting'
WHERE id = :id;
