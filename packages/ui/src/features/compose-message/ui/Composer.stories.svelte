<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Message } from '#entities/message/index.js'
  import Composer from './Composer.svelte'

  const noop = () => {}

  const { Story } = defineMeta({
    title: 'Kodama/Composer',
    component: Composer,
    tags: ['autodocs'],
    args: {
      agentName: 'assistant',
      running: false,
      queue: [],
      mobile: false,
      onsend: noop,
      onqueue: noop,
      onremove: noop,
      oncancel: noop,
    },
    argTypes: {
      running: { control: 'boolean' },
      mobile: { control: 'boolean' },
    },
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'The pill-shaped input floating at the bottom of a conversation, centered in its 720px column. Enter sends and Shift+Enter breaks the line; the input grows with its lines. While the agent runs, the right end is stop until something is typed, then send, which interrupts the run. Typing during a run opens a sheet above the input offering Tab to add the message to a queue instead; the sheet lists the queue, which this screen sends in order when the run ends. Phones have no Tab, so the sheet shows a 「キューに追加」 button. Source: `design/components/Composer`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  type Entry = { id: number; role: 'user' | 'assistant' | 'thinking'; text: string }

  let nextId = 2
  let log: Entry[] = $state([
    { id: 0, role: 'user', text: 'Durable Objects のアラームについてまとめて' },
    { id: 1, role: 'assistant', text: '了解しました。' },
  ])
  let running = $state(false)
  let queue: string[] = $state([])
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Sends a message and starts a short run that ends in a reply, as the design's preview does. */
  function send(text: string): void {
    log = log.filter((entry) => entry.role !== 'thinking')
    log.push(
      { id: nextId++, role: 'user', text },
      { id: nextId++, role: 'thinking', text: '考えています' },
    )
    running = true
    clearTimeout(timer)
    timer = setTimeout(finish, 2600)
  }

  /** Ends the run with a reply, then sends the front of the queue. */
  function finish(): void {
    log = log.filter((entry) => entry.role !== 'thinking')
    log.push({ id: nextId++, role: 'assistant', text: '了解しました。' })
    running = false
    sendNextQueued()
  }

  /** Stop: ends the run without a reply, then sends the front of the queue. */
  function cancel(): void {
    clearTimeout(timer)
    log = log.filter((entry) => entry.role !== 'thinking')
    running = false
    sendNextQueued()
  }

  /**
   * Sends the front of the queue after a moment. The message stays queued until then, so one sent
   * by hand in the meantime keeps it waiting for the next run, and one removed is not sent.
   */
  function sendNextQueued(): void {
    if (queue.length === 0) return
    timer = setTimeout(() => {
      const next = queue.shift()
      if (next !== undefined) send(next)
    }, 400)
  }
</script>

<Story name="Default" />

<Story
  asChild
  name="States"
  parameters={{
    docs: {
      description: {
        story:
          'Idle with nothing typed (send is disabled); running with nothing typed (stop); typing during a run (the sheet offers Tab); and a queue of two waiting for the run to end.',
      },
    },
  }}
>
  <div class="flex flex-col gap-8 py-4">
    <Composer agentName="assistant" onsend={noop} onqueue={noop} onremove={noop} oncancel={noop} />
    <Composer
      agentName="assistant"
      running
      onsend={noop}
      onqueue={noop}
      onremove={noop}
      oncancel={noop}
    />
    <Composer
      agentName="assistant"
      running
      value="出典のURLも添えて"
      onsend={noop}
      onqueue={noop}
      onremove={noop}
      oncancel={noop}
    />
    <Composer
      agentName="assistant"
      running
      queue={['出典のURLも添えて', '最後に3行で要約して']}
      onsend={noop}
      onqueue={noop}
      onremove={noop}
      oncancel={noop}
    />
  </div>
</Story>

<Story
  asChild
  name="Phone"
  parameters={{
    docs: {
      description: {
        story: 'On a phone there is no Tab key, so the sheet offers a 「キューに追加」 button.',
      },
    },
  }}
>
  <div class="mx-auto max-w-97.5 py-4">
    <Composer
      agentName="assistant"
      running
      mobile
      value="出典のURLも添えて"
      queue={['最後に3行で要約して']}
      onsend={noop}
      onqueue={noop}
      onremove={noop}
      oncancel={noop}
    />
  </div>
</Story>

<Story
  asChild
  name="Conversation"
  parameters={{
    docs: {
      description: {
        story:
          'Try it: send a message, then type while the agent runs. Enter interrupts the run; Tab queues the message, and the queue is sent in order once the run ends. Each run here ends on its own after a moment.',
      },
    },
  }}
>
  <div class="mx-auto flex max-w-180 flex-col gap-6 py-4">
    <div class="flex flex-col gap-3">
      {#each log as entry (entry.id)}
        {#if entry.role === 'user'}
          <Message role="user">{entry.text}</Message>
        {:else if entry.role === 'thinking'}
          <Message role="thinking" typing>{entry.text}</Message>
        {:else}
          <Message role="assistant"><p>{entry.text}</p></Message>
        {/if}
      {/each}
    </div>
    <Composer
      agentName="assistant"
      {running}
      {queue}
      onsend={send}
      onqueue={(text) => queue.push(text)}
      onremove={(index) => queue.splice(index, 1)}
      oncancel={cancel}
    />
  </div>
</Story>
