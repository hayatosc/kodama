SELECT seq
FROM kodama_usage
WHERE seq <= :through AND status = 'in_flight'
LIMIT 1;
