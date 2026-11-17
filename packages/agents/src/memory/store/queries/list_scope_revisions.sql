SELECT scope, revision, updated_at AS updatedAt
FROM scope_revisions
WHERE scope IN (SELECT CAST(value AS TEXT) FROM json_each(:scopesJson::text));
