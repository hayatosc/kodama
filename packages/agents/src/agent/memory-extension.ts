/**
 * The extension that gives a working agent its memory and skills, whatever its tool choice.
 *
 * @see docs/memory.md — Working agents
 *
 * @module
 */
import { defineExtension, section } from '@earendil-works/pi-durable'
import type { Extension, Harness } from '@earendil-works/pi-durable'
import type { VisibleSkill } from '../memory/skills.ts'
import type { VisibleTask } from '../memory/tasks.ts'
import { storedMemoryText, storedSkills, storedTasks } from '../memory/working/always-loaded.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { recentOutboxSummaries } from './local-db/notifications.ts'
import { wrapToolsWithPermissions } from './permissions.ts'
import type { PermissionDeps } from './permissions.ts'
import {
  historySearchTool,
  memorySearchTool,
  rememberTool,
  skillReadTool,
  taskReadTool,
  taskWriteTool,
} from '../tools/memory/working.ts'

function skillsText(skills: readonly VisibleSkill[]): string | undefined {
  if (skills.length === 0) return undefined
  return [
    'Skills: procedures saved from earlier work. Before a task one of them covers, read it with skill_read and follow it.',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join('\n')
}

function tasksText(tasks: readonly VisibleTask[]): string | undefined {
  if (tasks.length === 0) return undefined
  return [
    'Active tasks: multi-step checkpoints persisted across session resets. Read details with task_read or update progress with task_write.',
    ...tasks.map((task) => `- [${task.status}] ${task.slug} — ${task.title}: ${task.summary}`),
  ].join('\n')
}

function outboxText(
  items: readonly { seq: number; summary: string; createdAt: number }[],
): string | undefined {
  if (items.length === 0) return undefined
  return [
    'Recent alerts already sent to the operator (avoid repeating identical alerts):',
    ...items.map((item) => `- (${new Date(item.createdAt).toISOString()}) ${item.summary}`),
  ].join('\n')
}

/** Tools and the always-loaded sections every working agent gets, whatever its tool choice. */
export function createWorkingMemoryExtension(
  deps: WorkingMemoryDeps,
  harness: () => Promise<Harness>,
  permissions?: PermissionDeps,
): Extension {
  const rawTools = [
    memorySearchTool(deps),
    rememberTool(deps, harness),
    historySearchTool(deps),
    skillReadTool(deps),
    taskWriteTool(deps, harness),
    taskReadTool(deps),
  ]
  return defineExtension({
    name: 'kodama-memory',
    tools: permissions ? wrapToolsWithPermissions(rawTools, permissions) : rawTools,
    sections: [
      section('memory', async () => {
        const text = await storedMemoryText(deps)
        return text.length === 0 ? undefined : text
      }),
      section('skills', async () => skillsText(await storedSkills(deps))),
      section('tasks', async () => tasksText(await storedTasks(deps))),
      section('recent-outbox', async () =>
        outboxText(recentOutboxSummaries(await deps.local(), 5)),
      ),
    ],
  })
}
