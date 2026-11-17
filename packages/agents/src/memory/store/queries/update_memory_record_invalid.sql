UPDATE memory_records
SET
  status = 'invalid',
  revision = :nextRevision,
  updated_at = :updatedAt
WHERE id = :id AND status = 'active' AND revision = :revision;
