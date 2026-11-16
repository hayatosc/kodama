DELETE FROM kodama_event_inbox
WHERE state IN ('admitted', 'settled', 'failed') AND settled_at <= :before;
