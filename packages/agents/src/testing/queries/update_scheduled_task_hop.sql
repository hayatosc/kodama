UPDATE kodama_scheduled_tasks
SET followup_hop = :followupHop
WHERE id = :id;
