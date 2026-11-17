UPDATE kodama_contact_receipts
SET acknowledged_at = :acknowledgedAt, expires_at = :expiresAt
WHERE sender_agent_id = :senderAgentId
  AND request_id = :requestId
  AND acknowledged_at IS NULL;
