WITH input AS (
  SELECT :root::text AS root
)
DELETE FROM kodama_known_urls
WHERE root = (SELECT root FROM input)
  AND url IN (
    SELECT url
    FROM kodama_known_urls
    WHERE root = (SELECT root FROM input)
    ORDER BY granted_at DESC
    LIMIT 9223372036854775807 OFFSET :offset
  );
