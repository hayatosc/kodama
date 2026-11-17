INSERT INTO kodama_always_loaded (
  id, text, revisions_json, skills_json, tasks_json, checked_at
) VALUES (
  1, '', '{}', '[]', :tasksJson, 0
)
ON CONFLICT (id) DO UPDATE SET tasks_json = excluded.tasks_json;
