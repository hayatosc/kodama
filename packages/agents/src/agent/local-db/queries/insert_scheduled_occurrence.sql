INSERT INTO kodama_scheduled_occurrences (
  id, task_id, nominal_at, coalesced_from, state, retry_at
) VALUES (
  :id, :taskId, :nominalAt, :coalescedFrom, 'dispatching', :retryAt
)
RETURNING
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
  settled_at AS settledAt;
