UPDATE kodama_notifications
SET delivery_state = 'suppressed'
WHERE seq IN (SELECT CAST(value AS INTEGER) FROM json_each(:seqsJson::text));
