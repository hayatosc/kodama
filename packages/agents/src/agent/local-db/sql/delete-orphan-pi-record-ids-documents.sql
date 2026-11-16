DELETE FROM record_ids
WHERE record_type = 'document'
  AND id NOT IN (SELECT id FROM documents);
