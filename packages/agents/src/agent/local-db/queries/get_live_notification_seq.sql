SELECT seq
FROM kodama_notifications
WHERE seq = :seq AND expires_at > :now;
