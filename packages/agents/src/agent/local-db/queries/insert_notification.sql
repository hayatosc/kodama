INSERT INTO kodama_notifications (
  source, source_id, outcome, summary, details, artifact_ids, delivery_state, deliver_after, created_at, expires_at
) VALUES (
  :source, :sourceId, :outcome, :summary, :details, :artifactIdsJson, :deliveryState, :deliverAfter, :createdAt, :expiresAt
)
ON CONFLICT (source, source_id) DO NOTHING
RETURNING
  seq,
  source,
  source_id AS sourceId,
  outcome,
  summary,
  details,
  artifact_ids AS artifactIdsJson,
  delivery_state AS deliveryState,
  deliver_after AS deliverAfter,
  created_at AS createdAt,
  expires_at AS expiresAt,
  read_at AS readAt;
