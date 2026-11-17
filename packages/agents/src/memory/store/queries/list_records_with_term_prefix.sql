WITH input AS (
  SELECT
    :own::nullable(text) AS own,
    :scopesJson::text AS scopes_json
)
SELECT mt.record_id AS id
FROM memory_terms AS mt
INNER JOIN memory_records AS mr ON mr.id = mt.record_id
CROSS JOIN input
WHERE mt.term >= :termFrom
  AND mt.term < :termTo
  AND mr.status = 'active'
  AND mr.scope IN (SELECT CAST(value AS TEXT) FROM json_each(input.scopes_json))
  AND (
    input.own IS NULL
    OR (
      mr.scope = input.own
      AND NOT EXISTS (
        SELECT 1
        FROM memory_records AS required_target
        WHERE required_target.id = mr.overrides
          AND required_target.status = 'active'
          AND required_target.required = 1
          AND required_target.scope != input.own
          AND required_target.scope IN (SELECT CAST(value AS TEXT) FROM json_each(input.scopes_json))
      )
    )
    OR (
      mr.scope != input.own
      AND (
        mr.required = 1
        OR NOT EXISTS (
          SELECT 1
          FROM memory_records AS agent_override
          WHERE agent_override.overrides = mr.id
            AND agent_override.scope = input.own
            AND agent_override.status = 'active'
        )
      )
    )
  )
LIMIT :limit;
