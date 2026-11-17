UPDATE agents
SET display_name = COALESCE(:displayName::nullable(text), display_name),
    slug = CASE WHEN :updateSlug = 1 THEN :slug::nullable(text) ELSE slug END,
    updated_at = :updatedAt
WHERE agent_id = :agentId;
