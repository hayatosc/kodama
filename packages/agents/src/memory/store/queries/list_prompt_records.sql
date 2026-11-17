WITH input AS (
  SELECT
    :own::text AS own,
    :scopesJson::text AS scopes_json,
    :readableJson::text AS readable_json,
    :kindsJson::text AS kinds_json
)
SELECT
  mr.id,
  mr.scope,
  mr.kind,
  mr.content,
  mr.search_version AS searchVersion,
  mr.status,
  mr.superseded_by AS supersededBy,
  mr.origin,
  mr.source_agent_id AS sourceAgentId,
  mr.source_entry_from AS sourceEntryFrom,
  mr.source_entry_to AS sourceEntryTo,
  mr.run_id AS runId,
  mr.importance,
  mr.pinned,
  mr.overrides,
  mr.required,
  mr.use_count AS useCount,
  mr.last_used_at AS lastUsedAt,
  mr.observed_at AS observedAt,
  mr.created_at AS createdAt,
  mr.updated_at AS updatedAt,
  mr.revision
FROM memory_records AS mr
CROSS JOIN input
WHERE mr.scope IN (SELECT CAST(value AS TEXT) FROM json_each(input.scopes_json))
  AND mr.status = 'active'
  AND mr.kind IN (SELECT CAST(value AS TEXT) FROM json_each(input.kinds_json))
  AND (
    (
      mr.scope = input.own
      AND NOT EXISTS (
        SELECT 1
        FROM memory_records AS required_target
        WHERE required_target.id = mr.overrides
          AND required_target.status = 'active'
          AND required_target.required = 1
          AND required_target.scope != input.own
          AND required_target.scope IN (SELECT CAST(value AS TEXT) FROM json_each(input.readable_json))
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
ORDER BY mr.pinned DESC, mr.importance DESC, mr.last_used_at DESC
LIMIT :limit;
