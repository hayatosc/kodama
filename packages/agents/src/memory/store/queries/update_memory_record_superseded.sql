UPDATE memory_records
SET
  status = 'superseded',
  superseded_by = :supersededBy,
  revision = :nextRevision,
  updated_at = :updatedAt
WHERE id = :id AND status = 'active' AND revision = :revision;
