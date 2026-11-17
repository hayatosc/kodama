SELECT
  term,
  record_id AS recordId
FROM memory_terms
WHERE record_id = :recordId;
