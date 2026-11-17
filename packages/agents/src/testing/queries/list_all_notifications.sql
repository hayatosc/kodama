SELECT
  seq,
  source,
  source_id AS sourceId,
  outcome,
  summary,
  details,
  artifact_ids AS artifactIds,
  delivery_state AS deliveryState,
  deliver_after AS deliverAfter,
  created_at AS createdAt,
  expires_at AS expiresAt,
  read_at AS readAt
FROM kodama_notifications
ORDER BY seq ASC;
