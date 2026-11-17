SELECT head
FROM entries
WHERE conversation_id = :conversationId AND head IS NOT NULL
ORDER BY id DESC
LIMIT 1;
