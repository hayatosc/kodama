UPDATE kodama_contact_receipts
SET submission_id = :submissionId
WHERE sender_agent_id = :senderAgentId
  AND request_id = :requestId
  AND settled_at IS NULL;
