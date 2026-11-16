INSERT INTO scope_revisions (scope, revision, updated_at)
VALUES (:scope, :revision, :updatedAt)
ON CONFLICT (scope) DO UPDATE SET
  revision = excluded.revision,
  updated_at = excluded.updated_at;
