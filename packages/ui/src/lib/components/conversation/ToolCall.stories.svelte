<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ToolCall from './ToolCall.svelte'

  const longResult = [
    '10/28 アラームの再試行について',
    '10/21 朝のまとめの時刻',
    '10/12 Durable Objects の料金',
    '10/02 スケジューラーの設計',
    '09/28 記憶の整理の頻度',
    '09/19 MCP サーバーの登録',
    '09/11 ツールの権限',
    '09/03 最初の設定',
  ].join('\n')

  const { Story } = defineMeta({
    title: 'Kodama/ToolCall',
    component: ToolCall,
    tags: ['autodocs'],
    args: {
      name: 'web_search',
      summary: '"Durable Objects alarms"',
      state: 'done',
      durationMs: 2100,
      args: { query: 'Durable Objects alarms', limit: 5 },
      result: 'Alarms · Cloudflare Docs\nDurable Objects: Alarms API\nHow alarms are retried',
      resultSize: '5 件',
    },
    argTypes: {
      state: { control: 'inline-radio', options: ['running', 'done', 'error'] },
      open: { control: 'boolean' },
    },
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'A tool call folded into one line: name, summary, and duration. Open it to see the arguments as highlighted JSON (keys in live, strings in running, numbers in destructive) and the result. Results over five lines are clipped behind すべて表示 (show all). While running, a blinking dot replaces the chevron, the duration counts up, and a thin bar moves along the bottom. A failure turns the name and time destructive and shows the tool’s own error on one line. Source: `design/components/ToolCall`.',
        },
      },
    },
  })
</script>

<Story name="Done" />

<Story name="Open" args={{ open: true }} />

<Story
  name="Long result"
  args={{
    name: 'history_search',
    summary: '8 件',
    durationMs: 400,
    args: { query: 'アラーム' },
    result: longResult,
    resultSize: '8 件',
    open: true,
  }}
/>

<Story
  name="Running"
  args={{
    name: 'contact_agent',
    summary: 'research',
    state: 'running',
    startedAt: Date.now() - 12_000,
    durationMs: undefined,
    args: { target: 'research', message: '論文側の調査をお願い' },
    result: undefined,
    open: true,
  }}
/>

<Story
  name="Error"
  args={{
    name: 'fetch',
    summary: 'example.com/report',
    state: 'error',
    durationMs: 1300,
    args: { url: 'https://example.com/report' },
    result: undefined,
    error: '403 Forbidden',
    open: true,
  }}
/>
