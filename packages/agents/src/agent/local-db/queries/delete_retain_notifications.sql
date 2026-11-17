DELETE FROM kodama_notifications
WHERE expires_at <= :now;
