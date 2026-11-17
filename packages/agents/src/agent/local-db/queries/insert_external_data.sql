INSERT INTO kodama_external_data (root, reason, contacted_at, eligible_through)
VALUES (:root, :reason, :contactedAt, :eligibleThrough)
ON CONFLICT DO NOTHING;
