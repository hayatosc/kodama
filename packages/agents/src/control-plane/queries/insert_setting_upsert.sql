INSERT INTO system_settings (key, value_json)
VALUES (:key, :valueJson)
ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json;
