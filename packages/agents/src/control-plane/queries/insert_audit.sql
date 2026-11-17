INSERT INTO audit_log (op_id, at, source, action, target_kind, target_id, detail_json)
VALUES (:opId, :at, :source, :action, :targetKind, :targetId, :detailJson);
