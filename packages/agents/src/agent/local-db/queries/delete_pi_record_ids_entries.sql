DELETE FROM record_ids
WHERE record_type = 'entry' AND id > :after AND id < :before;
