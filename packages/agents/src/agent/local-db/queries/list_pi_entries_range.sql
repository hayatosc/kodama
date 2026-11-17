SELECT id, record
FROM entries
WHERE conversation_id = :conversationId AND id > :after AND id < :before
ORDER BY id ASC
LIMIT :limit;
