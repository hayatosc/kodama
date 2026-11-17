UPDATE kodama_notifications
SET delivery_state = 'dispatched', deliver_after = :deliverAfter
WHERE seq = :seq;
