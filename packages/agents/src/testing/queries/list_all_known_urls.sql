SELECT
  root,
  url,
  source,
  granted_at AS grantedAt
FROM kodama_known_urls
ORDER BY root ASC, granted_at ASC;
