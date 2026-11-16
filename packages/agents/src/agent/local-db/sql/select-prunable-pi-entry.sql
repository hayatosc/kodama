SELECT id
FROM entries
WHERE conversation_id = :conversationId AND id > :after AND id < :head
LIMIT 1;
