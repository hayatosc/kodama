SELECT
  id,
  text,
  revisions_json AS revisionsJson,
  skills_json AS skillsJson,
  tasks_json AS tasksJson,
  checked_at AS checkedAt
FROM kodama_always_loaded
WHERE id = 1;
