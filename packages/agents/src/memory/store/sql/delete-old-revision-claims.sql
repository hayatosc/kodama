DELETE FROM revision_claims
WHERE claimed_at < :before;
