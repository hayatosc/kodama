SELECT expires_at AS at
FROM kodama_contact_receipts
WHERE expires_at > :now
ORDER BY expires_at ASC
LIMIT 1;
