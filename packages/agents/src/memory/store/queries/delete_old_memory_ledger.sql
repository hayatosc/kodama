DELETE FROM memory_ledger
WHERE seq IN (
  SELECT seq FROM memory_ledger WHERE at < :before LIMIT :limit
);
