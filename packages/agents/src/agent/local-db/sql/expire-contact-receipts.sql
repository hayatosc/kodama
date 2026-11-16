UPDATE kodama_contact_receipts
SET result = NULL
WHERE expires_at <= :now;
