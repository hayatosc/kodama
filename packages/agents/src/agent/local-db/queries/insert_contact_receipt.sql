INSERT INTO kodama_contact_receipts (
  sender_agent_id, request_id, submission_id, created_at
) VALUES (
  :senderAgentId, :requestId, 0, :createdAt
)
ON CONFLICT DO NOTHING;
