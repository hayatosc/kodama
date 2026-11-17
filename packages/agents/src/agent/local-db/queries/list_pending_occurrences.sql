WITH input AS (
  SELECT :now::nullable(int) AS now_at
)
SELECT
  o.id AS occId,
  o.task_id AS occTaskId,
  o.nominal_at AS occNominalAt,
  o.coalesced_from AS occCoalescedFrom,
  o.state AS occState,
  o.submission_id AS occSubmissionId,
  o.admission_started AS occAdmissionStarted,
  o.retry_at AS occRetryAt,
  o.attempts AS occAttempts,
  o.outcome AS occOutcome,
  o.settled_at AS occSettledAt,
  t.id AS taskId,
  t.source_task AS taskSourceTask,
  t.source_entry AS taskSourceEntry,
  t.arguments AS taskArguments,
  t.instruction AS taskInstruction,
  t.rule AS taskRuleJson,
  t.category AS taskCategory,
  t.followup_hop AS taskFollowupHop,
  t.session_mode AS taskSessionMode,
  t.state AS taskState,
  t.next_due AS taskNextDue,
  t.cursor AS taskCursor,
  t.created_at AS taskCreatedAt
FROM kodama_scheduled_occurrences AS o
INNER JOIN kodama_scheduled_tasks AS t ON t.id = o.task_id
CROSS JOIN input
WHERE o.state IN ('dispatching', 'submitted')
  AND (input.now_at IS NULL OR o.retry_at <= input.now_at)
ORDER BY o.retry_at ASC, o.id ASC
LIMIT 100;
