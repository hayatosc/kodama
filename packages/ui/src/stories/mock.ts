/**
 * Mock data shared by the stories: one installation's agents, their activity, memories, and
 * tools, all relative to a fixed "now" so every story renders the same times.
 *
 * @module
 */

import type {
  ActivityItem,
  AgentTool,
  MemoryItem,
  SelectOption,
  SidebarAgent,
} from '#lib/components/types.ts'

/** The moment the mock data is read at: 2026-11-09 09:30, local time. */
export const NOW = new Date(2026, 10, 9, 9, 30)

/** An ISO time a number of minutes before NOW. */
export function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString()
}

/** The main agent, seeded first. */
export const mainAgent: SidebarAgent = {
  agentId: '019a6b2e-1d3c-7f00-8a51-0c4b9e2d7f13',
  slug: 'assistant',
  kind: 'working',
  status: 'running',
  avatar: { color: 'ink', pose: 'write' },
  latest: 'research と調査中',
  latestAt: ago(0),
  unread: 0,
}

/** The other working agents, in no particular order (the sidebar sorts them). */
export const workingAgents: SidebarAgent[] = [
  {
    agentId: '7f3a9c21-4b8e-7d10-9a2f-1c5e8b3d6a40',
    slug: 'research',
    kind: 'working',
    status: 'live',
    avatar: { color: 'violet', pose: 'live' },
    latest: '論文 3 件の要約を返しました',
    latestAt: ago(4),
    unread: 2,
  },
  {
    agentId: '2c9e0d41-6a7b-7c22-8e13-4f5a6b7c8d90',
    slug: 'scheduler',
    kind: 'working',
    status: 'queued',
    avatar: { color: 'teal', pose: 'sleep' },
    latest: '次は 03:00 に起きます',
    latestAt: ago(390),
    unread: 0,
  },
  {
    agentId: '5b1f2a63-9c8d-7e44-a0b1-2c3d4e5f6a70',
    slug: 'mailer',
    kind: 'working',
    status: 'error',
    avatar: { color: 'red', pose: 'worried' },
    latest: '認証情報が見つかりません',
    latestAt: ago(60),
    unread: 0,
  },
  {
    agentId: '8d4c3b25-1e0f-7a66-b2c3-4d5e6f7a8b90',
    slug: 'clipper',
    kind: 'working',
    status: 'done',
    avatar: { color: 'orange', pose: 'idle' },
    latest: '記事を 5 件保存しました',
    latestAt: ago(60 * 20),
    unread: 0,
  },
  {
    agentId: '9e5d4c36-2f1a-7b88-c3d4-5e6f7a8b9c01',
    slug: 'writer',
    kind: 'working',
    status: 'paused',
    avatar: { color: 'pink', pose: 'paused' },
    latest: '一時停止中',
    latestAt: ago(60 * 24 * 3),
    unread: 0,
  },
]

/** Dedicated agents. */
export const systemAgents: SidebarAgent[] = [
  {
    agentId: '0a1b2c3d-4e5f-7a00-8b1c-2d3e4f5a6b7c',
    slug: 'system:memory',
    kind: 'dedicated',
    status: 'running',
    avatar: { color: 'system', pose: 'write' },
    latest: '記憶の抽出キューを処理中',
    latestAt: ago(1),
    unread: 0,
  },
]

/** What the main agent did overnight, newest first. */
export const activity: ActivityItem[] = [
  { at: ago(30), kind: 'cron', subject: '朝のまとめを作成中', detail: '· cron', active: true },
  { at: ago(78), kind: 'peer', subject: 'research', detail: 'から返信 · 論文 3 件' },
  { at: ago(390), kind: 'alarm', subject: 'アラームで再開', detail: '· 中断した run を復旧' },
  { at: ago(409), kind: 'memory', subject: '記憶を抽出', detail: '· 2 件追加、1 件更新' },
  { at: ago(410), kind: 'error', subject: 'web_fetch 失敗', detail: '· 403 Forbidden' },
  { at: ago(60 * 14), kind: 'config', subject: '設定 v12 を適用', detail: '· v11 から' },
  { at: ago(60 * 24 * 12), kind: 'run', subject: '最初の会話', detail: '· 12 ターン' },
]

/** What the main agent remembers. */
export const memories: MemoryItem[] = [
  {
    kind: '事実',
    text: '発表は 11/14 の金曜日、持ち時間は 20 分',
    source: 'research',
    at: ago(60 * 24 * 10),
  },
  {
    kind: '好み',
    text: 'まとめは箇条書き 3 点までにする',
    source: 'あなた',
    at: ago(60 * 24 * 12),
  },
  {
    kind: '手順',
    text: '朝のまとめは 09:00 に作り、未読があれば先に伝える',
    source: 'scheduler',
    at: ago(60 * 24 * 19),
  },
]

/** The main agent's tools. */
export const tools: AgentTool[] = [
  { name: 'web_search', description: 'ウェブを検索して結果を要約します', enabled: true },
  { name: 'web_fetch', description: 'URL の本文を取得します', enabled: true },
  { name: 'execute_code', description: 'サンドボックスでコードを実行します', enabled: false },
  {
    name: 'remember',
    description: '記憶を保存します。システムが管理しているため変更できません',
    enabled: true,
    locked: true,
  },
]

/** Provider choices. */
export const providers: SelectOption[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
]

/** Model choices for the selected provider, newest first. */
export const models: SelectOption[] = [
  { value: 'claude-opus-5-5', label: 'claude-opus-5-5', group: '最新' },
  { value: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5', group: '最新' },
  { value: 'claude-haiku-5-5', label: 'claude-haiku-5-5', group: '最新' },
  { value: 'claude-opus-5', label: 'claude-opus-5', group: '以前のモデル' },
  { value: 'claude-sonnet-5', label: 'claude-sonnet-5', group: '以前のモデル' },
  { value: 'claude-haiku-5', label: 'claude-haiku-5', group: '以前のモデル' },
  { value: 'claude-opus-4-7', label: 'claude-opus-4-7', group: '以前のモデル' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', group: '以前のモデル' },
  { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5', group: '以前のモデル' },
]
