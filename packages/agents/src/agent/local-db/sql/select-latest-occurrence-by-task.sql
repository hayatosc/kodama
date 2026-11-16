SELECT
  id,
  task_id AS taskId,
  nominal_at AS nominalAt,
  coalesced_from AS coalescedFrom,
  state,
  submission_id AS submissionId,
  admission_started AS admissionStarted,
  retry_at AS retryAt,
  attempts,
  outcome,
  settled_at AS settledAt
FROM kodama_scheduled_occurrences
WHERE task_id = :taskId
ORDER BY nominal_at DESC
LIMIT 1;
