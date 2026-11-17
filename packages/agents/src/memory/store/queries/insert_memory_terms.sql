INSERT INTO memory_terms (term, record_id)
SELECT CAST(value AS TEXT), :recordId
FROM json_each(:termsJson::text);
