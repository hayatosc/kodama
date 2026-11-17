UPDATE kodama_contact_receipts
SET submission_id = :submissionId, result = :resultJson, settled_at = :settledAt
WHERE sender_agent_id = :senderAgentId
  AND request_id = :requestId
  AND settled_at IS NULL;
