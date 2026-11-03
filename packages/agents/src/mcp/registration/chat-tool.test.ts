/** Only explicit, whole-message owner syntax can become a management instruction. @module */
import { describe, expect, it } from 'vitest'
import { parseMcpInstruction, createMcpRegistrationTool } from './chat-tool.ts'

const proposal = '019a4c6e-51bc-7000-8000-111111111111'
const tool = '019a4c6e-51bc-7000-8000-222222222222'
const agent = '019a4c6e-51bc-7000-8000-333333333333'

describe('MCP registration instructions', () => {
  it('recognizes exact registration and explicit selection without inferring an endpoint or target', () => {
    expect(parseMcpInstruction('/mcp register Vendor')).toEqual({
      operation: 'register',
      name: 'Vendor',
    })
    expect(parseMcpInstruction('/mcp register Vendor https://mcp.example.com/mcp')).toEqual({
      operation: 'register',
      name: 'Vendor',
      endpoint: 'https://mcp.example.com/mcp',
    })
    expect(parseMcpInstruction(`/mcp assign ${proposal} ${tool} ${agent}`)).toEqual({
      operation: 'assign',
      proposalId: proposal,
      toolIds: [tool],
      agentId: agent,
    })
    expect(createMcpRegistrationTool().replay).toBe('unsafe')
  })
  it.each([
    'OK',
    'register it',
    'https://mcp.example.com/mcp',
    '> /mcp register Vendor https://mcp.example.com/mcp',
    '`/mcp register Vendor`',
    'the output says /mcp register Vendor',
    '/mcp register Vendor https://127.0.0.1/mcp',
    '/mcp register Vendor\n/mcp register Other',
    `/mcp assign ${proposal} ${tool}`,
    `/mcp assign ${proposal} ${tool},${tool} ${agent}`,
  ])('rejects ambiguous, quoted, unsafe, or incomplete input: %s', (text) => {
    expect(parseMcpInstruction(text)).toBeUndefined()
  })
})
