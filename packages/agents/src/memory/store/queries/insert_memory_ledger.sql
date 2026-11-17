INSERT INTO memory_ledger (at, run_id, op_id, actor, action, target, target_id, detail_json)
VALUES (
  :at,
  :runId,
  :opId::nullable(text),
  :actor,
  :action,
  :target,
  :targetId,
  :detailJson::nullable(text)
);
