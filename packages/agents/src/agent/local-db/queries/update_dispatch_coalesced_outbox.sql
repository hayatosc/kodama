UPDATE kodama_notifications
SET
  summary = :summary,
  details = :details,
  artifact_ids = :artifactIdsJson,
  delivery_state = 'dispatched',
  deliver_after = :deliverAfter
WHERE seq = :seq;
