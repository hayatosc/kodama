/**
 * Barrel of typed Reylo SQL queries for `mcp/invocation`.
 *
 * @module
 */
import deleteMcpCall from './delete_mcp_call.sql'
import getLatestMcpCallRunId from './get_latest_mcp_call_run_id.sql'
import getPiTaskById from './get_pi_task_by_id.sql'
import insertMcpCall from './insert_mcp_call.sql'
import listAgedMcpCalls from './list_aged_mcp_calls.sql'
import listAllMcpCalls from './list_all_mcp_calls.sql'
import listMcpCallsByRunAndTool from './list_mcp_calls_by_run_and_tool.sql'
import updateFinishMcpCall from './update_finish_mcp_call.sql'

/** Typed SQL queries owned by `mcp/invocation`. */
export const queries = {
  deleteMcpCall,
  getLatestMcpCallRunId,
  getPiTaskById,
  insertMcpCall,
  listAgedMcpCalls,
  listAllMcpCalls,
  listMcpCallsByRunAndTool,
  updateFinishMcpCall,
} as const
