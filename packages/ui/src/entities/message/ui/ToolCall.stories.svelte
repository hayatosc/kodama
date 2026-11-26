<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ToolCall from './ToolCall.svelte'

  const fetchedPage = `# Alarms

Durable Objects can be scheduled to be woken up at a time in the future
by setting an alarm. setAlarm() takes a timestamp in milliseconds…

## Retries

If the alarm() handler throws, it is retried with exponential backoff,
starting at 2 seconds, for up to 6 retries.

## Limits

Each Durable Object can have one alarm set at a time.`

  const searchResults = [
    '1. Alarms · Durable Objects — developers.cloudflare.com/durable-objects/api/alarms',
    '2. Durable Objects: Alarms are now GA — blog.cloudflare.com/durable-objects-alarms',
    '3. Retry behaviour for alarm handlers — developers.cloudflare.com/…/alarms#retries',
  ].join('\n')

  const { Story } = defineMeta({
    title: 'Kodama/ToolCall',
    component: ToolCall,
    tags: ['autodocs'],
    args: {
      name: 'history_search',
      summary: '4 件',
      state: 'done',
      durationMs: 400,
      args: { query: 'アラーム' },
      result:
        '10/28 アラームの再試行について\n10/21 朝のまとめの時刻\n10/12 Durable Objects の料金\n10/02 スケジューラーの設計',
      resultSize: '4 件',
      open: false,
    },
    argTypes: {
      state: { control: 'inline-radio', options: ['running', 'done', 'error'] },
      open: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'One tool execution folded into a row: a chevron, the tool’s name, a one-line summary, and the time on the right. The whole row is the toggle (a native <details>), and opening it shows the arguments as colored JSON and the result, each with a copy button. A result over five lines is clipped until 「すべて表示」. While the call runs, a dot replaces the chevron, the time counts up, and a thin bar moves along the bottom; a failed call turns its name and time red and shows the tool’s error as it came. Closed by default; a failed call may start open. Source: `design/components/ToolCall`.',
        },
      },
    },
  })
</script>

<Story name="Default" />

<Story
  asChild
  name="States"
  parameters={{
    docs: {
      description: {
        story:
          'A finished call, a long result clipped to five lines, a call still waiting for a peer agent, and a failed call.',
      },
    },
  }}
>
  <div class="flex max-w-140 flex-col gap-3">
    <ToolCall
      name="web_search"
      summary="&quot;Durable Objects alarms&quot;"
      state="done"
      durationMs={2_100}
      args={{ query: 'Durable Objects alarms', limit: 5 }}
      result={searchResults}
      resultSize="5 件"
      open
    />
    <ToolCall
      name="web_fetch"
      summary="developers.cloudflare.com/…/alarms"
      state="done"
      durationMs={900}
      args={{ url: 'https://developers.cloudflare.com/durable-objects/api/alarms/' }}
      result={fetchedPage}
      resultSize="2.4 KB"
      open
    />
    <ToolCall
      name="contact_agent"
      summary="research に依頼中"
      state="running"
      durationMs={12_000}
      args={{ target: 'research', message: '論文側の調査をお願い' }}
      open
    />
    <ToolCall
      name="web_fetch"
      summary="403 Forbidden"
      state="error"
      durationMs={800}
      args={{ url: 'https://example.com/paper.pdf' }}
      error="403 Forbidden"
      open
    />
  </div>
</Story>
