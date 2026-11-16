INSERT INTO kodama_known_urls (root, url, source, granted_at)
VALUES (:root, :url, :source, :grantedAt)
ON CONFLICT (root, url) DO UPDATE SET granted_at = excluded.granted_at;
