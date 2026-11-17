UPDATE kodama_artifacts
SET state = 'ready'
WHERE id = :id AND state = 'uploading';
