UPDATE kodama_event_inbox
SET state = 'settled', batch_request_id = NULL, settled_at = :settledAt
WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(:idsJson::text));
