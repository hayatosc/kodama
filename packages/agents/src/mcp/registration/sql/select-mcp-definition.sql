SELECT definition_json AS definitionJson
FROM mcp_definitions
WHERE digest = :digest;
