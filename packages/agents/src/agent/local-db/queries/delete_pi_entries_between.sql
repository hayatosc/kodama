DELETE FROM entries
WHERE conversation_id = :conversationId AND id > :after AND id < :before;
