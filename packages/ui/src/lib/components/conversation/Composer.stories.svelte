<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import Composer from './Composer.svelte'

  const { Story } = defineMeta({
    title: 'Kodama/Composer',
    component: Composer,
    tags: ['autodocs'],
    args: {
      agentName: 'assistant',
      running: false,
      queue: [],
      onsend: fn(),
      onqueue: fn(),
      onremove: fn(),
      oncancel: fn(),
    },
    argTypes: {
      running: { control: 'boolean' },
      mobile: { control: 'boolean' },
      value: { control: 'text' },
    },
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'The pill-shaped input at the bottom of the conversation. Enter sends; while the agent is running, Enter interrupts the run and Tab adds the message to this screen’s queue instead, which is sent in order when the run ends. Shift+Enter adds a line. A sheet above the input opens only while typing during a run or when something is queued. Phones have no Tab key, so the sheet shows a キューに追加 (add to queue) button. Source: `design/components/Composer`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let running = $state(true)
  let queue = $state<string[]>(['図は 2 枚まで', 'スライドは英語で'])
  let sent = $state<string[]>([])
</script>

<Story name="Idle" />

<Story name="Running, empty" args={{ running: true }} />

<Story name="Running, typing" args={{ running: true, value: '再試行の回数も入れて' }} />

<Story name="Queued" args={{ running: true, queue: ['図は 2 枚まで', 'スライドは英語で'] }} />

<Story name="Phone" args={{ running: true, value: '再試行の回数も入れて', mobile: true }} />

<Story
  name="Try it"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A working example. Type and press Enter to send, or Tab while running to queue. Stop ends the run and sends the queue from the top, one at a time.',
      },
    },
  }}
>
  <div class="flex max-w-[760px] flex-col gap-4">
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={running} />
      実行中
    </label>
    <Composer
      agentName="assistant"
      {running}
      {queue}
      onsend={(text) => (sent = [...sent, running ? `割り込み: ${text}` : text])}
      onqueue={(text) => (queue = [...queue, text])}
      onremove={(index) => (queue = queue.filter((_, i) => i !== index))}
      oncancel={() => {
        running = false
        sent = [...sent, ...queue]
        queue = []
      }}
    />
    <ol class="flex flex-col gap-1 text-sm text-muted-foreground" aria-label="送ったメッセージ">
      {#each sent as text, index (index)}
        <li>{index + 1}. {text}</li>
      {/each}
    </ol>
  </div>
</Story>
