SELECT
  target,
  target_id AS targetId,
  revision,
  op_id AS opId,
  claimed_at AS claimedAt
FROM revision_claims;
