UPDATE kodama_notifications
SET read_at = :now
WHERE seq = :seq AND read_at IS NULL AND expires_at > :expiresAfter;
