UPDATE kodama_event_inbox
SET batch_request_id = NULL
WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(:idsJson::text))
  AND state = 'queued';
