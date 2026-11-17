UPDATE kodama_event_inbox
SET state = 'admitted', submission_id = :submissionId, settled_at = :settledAt
WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(:idsJson::text));
