SELECT
  sender_agent_id AS senderAgentId,
  request_id AS requestId,
  submission_id AS submissionId,
  result,
  created_at AS createdAt,
  settled_at AS settledAt,
  acknowledged_at AS acknowledgedAt,
  expires_at AS expiresAt
FROM kodama_contact_receipts
ORDER BY created_at ASC;
