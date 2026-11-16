DELETE FROM record_ids
WHERE record_type = 'task'
  AND id NOT IN (SELECT id FROM tasks);
