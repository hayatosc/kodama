UPDATE memory_records
SET search_version = :searchVersion
WHERE id = :id;
