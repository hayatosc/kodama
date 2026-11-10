<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Message from './Message.svelte'
  import ToolCall from './ToolCall.svelte'

  const research = {
    slug: 'research',
    agentId: '7f3a9c21-4b8e-7d10-9a2f-1c5e8b3d6a40',
    hop: 1,
    avatar: { color: 'violet', pose: 'live' },
  } as const

  /** The search summary, quoted as the tool row shows it. */
  const searchQuery = '"Durable Objects alarms"'

  /** A request typed over several lines with Shift+Enter. */
  const multiline =
    '来週の発表用にまとめておいて。\n図は 2 枚まで、再試行の話を中心に。\nスライドは英語で。'

  const { Story } = defineMeta({
    title: 'Kodama/Message',
    component: Message,
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'One utterance, told apart by shape: the user’s inverted pill on the right, a gray thinking pill (one sentence about the work, with dots on the latest), the agent’s gray bubble, and an outlined message from another agent with its avatar, name, UUID prefix, and hop count. The conversation is with one agent, so its bubbles carry no name. Source: `design/components/Message`.',
        },
      },
    },
  })
</script>

<Story name="User" asChild>
  <div class="flex flex-col">
    <Message role="user">Durable Objects のアラーム、来週の発表用にまとめておいて</Message>
  </div>
</Story>

<Story name="User, several lines" asChild>
  <div class="flex max-w-xl flex-col">
    <Message role="user">{multiline}</Message>
  </div>
</Story>

<Story name="Thinking" asChild>
  <div class="flex flex-col gap-2">
    <Message role="thinking">関連する過去の会話を探している。</Message>
    <Message role="thinking" typing>research に論文側を頼んでくる。</Message>
  </div>
</Story>

<Story name="Assistant" asChild>
  <Message role="assistant">
    <p>
      アラームは<strong>少なくとも 1 回</strong>実行され、失敗すると最大 6 回まで再試行されます。
    </p>
    <ul>
      <li>処理を冪等にする</li>
      <li><code>setAlarm()</code> は 1 つだけ</li>
    </ul>
  </Message>
</Story>

<Story name="Assistant, streaming" asChild>
  <Message role="assistant" streaming>
    <p>要点を三つにまとめると、まずアラームは</p>
  </Message>
</Story>

<Story name="Peer" asChild>
  <Message role="peer" from={research}>
    <p>関連する論文を 3 件見つけました。要約を添えて返します。</p>
  </Message>
</Story>

<Story
  name="Conversation"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A whole turn: the user’s request, thinking, a tool call to another agent, its reply, and the answer. Bubbles from one speaker sit 8px apart; a change of speaker adds 16px.',
      },
    },
  }}
>
  <div class="flex max-w-[720px] flex-col">
    <Message role="user">Durable Objects のアラーム、来週の発表用にまとめておいて</Message>
    <div class="mt-4 flex flex-col gap-2">
      <Message role="thinking">research に論文側を頼んでくる。</Message>
      <ToolCall
        name="contact_agent"
        summary="research · 返信あり"
        state="done"
        durationMs={38_000}
        args={{ target: 'research', message: '論文側の調査をお願い' }}
        resultLabel="返事"
        result="関連する論文を 3 件見つけました。要約を添えて返します。"
      />
      <Message role="peer" from={research}>
        <p>関連する論文を 3 件見つけました。要約を添えて返します。</p>
      </Message>
      <ToolCall
        name="web_search"
        summary={searchQuery}
        state="done"
        durationMs={2_100}
        args={{ query: 'Durable Objects alarms', limit: 5 }}
        resultSize="5 件"
        result="Alarms · Cloudflare Docs"
      />
      <Message role="assistant">
        <p>まとめました。要点は三つです。</p>
        <ul>
          <li>アラームは少なくとも 1 回実行される</li>
          <li>失敗すると指数バックオフで再試行される</li>
          <li>処理は冪等にしておく</li>
        </ul>
      </Message>
    </div>
  </div>
</Story>
