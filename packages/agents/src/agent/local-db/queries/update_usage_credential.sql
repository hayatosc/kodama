UPDATE kodama_usage
SET credential_id = :credentialId, credential_kind = :credentialKind
WHERE seq = :seq AND status = 'in_flight';
