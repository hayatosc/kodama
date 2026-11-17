INSERT INTO kodama_always_loaded (
  id, text, revisions_json, skills_json, tasks_json, checked_at
) VALUES (
  :id, :text, :revisionsJson, :skillsJson, :tasksJson, :checkedAt
)
ON CONFLICT (id) DO UPDATE SET
  text = excluded.text,
  revisions_json = excluded.revisions_json,
  skills_json = excluded.skills_json,
  tasks_json = excluded.tasks_json,
  checked_at = excluded.checked_at;
