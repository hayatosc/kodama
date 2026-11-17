INSERT INTO system_settings (key, value_json)
VALUES (:key, :valueJson)
ON CONFLICT (key) DO NOTHING;
