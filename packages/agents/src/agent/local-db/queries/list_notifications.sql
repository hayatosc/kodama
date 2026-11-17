WITH input AS (
  SELECT
    :before::nullable(int) AS before_seq,
    :unreadOnly::integer AS unread_only
)
SELECT
  n.seq,
  n.source,
  n.source_id AS sourceId,
  n.outcome,
  n.summary,
  n.details,
  n.artifact_ids AS artifactIdsJson,
  n.delivery_state AS deliveryState,
  n.deliver_after AS deliverAfter,
  n.created_at AS createdAt,
  n.expires_at AS expiresAt,
  n.read_at AS readAt,
  s.id AS scheduleId,
  s.settled_at AS scheduleSettledAt,
  c.id AS contactId,
  c.result AS contactResultJson,
  c.expires_at AS contactExpiresAt
FROM kodama_notifications AS n
CROSS JOIN input
LEFT JOIN kodama_scheduled_occurrences AS s
  ON n.source = 'schedule' AND n.source_id = s.id
LEFT JOIN kodama_contact_requests AS c
  ON n.source = 'contact' AND n.source_id = c.id
WHERE n.expires_at > :now
  AND n.delivery_state = 'dispatched'
  AND (input.before_seq IS NULL OR n.seq < input.before_seq)
  AND (input.unread_only = 0 OR n.read_at IS NULL)
ORDER BY n.seq DESC
LIMIT :limit;
