<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Message from './Message.svelte'
  import ToolCall from './ToolCall.svelte'
  import type { PeerSender } from '../model/message.js'

  const research: PeerSender = {
    slug: 'research',
    agentId: '7f3a9c21-4d1e-4b8a-9c3f-2e6d8a1b5c07',
    hop: 1,
    color: 'violet',
    pose: 'live',
  }

  const { Story } = defineMeta({
    title: 'Kodama/Message',
    component: Message,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'One utterance in the conversation. The four kinds are told apart by shape: the user’s black pill on the right (at most 70% wide), a gray thinking pill with one sentence about the work, the agent’s gray bubble with the rendered Markdown (at most 560px), and a bordered message from another agent, headed by its avatar, name, the first 8 characters of its UUID, and its hop count. The conversation is with one agent, so its bubbles carry no name. Only the latest thinking pill shows the typing dots; a streaming bubble ends in a caret. A snapshot replaces the whole list. Source: `design/components/Message`.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Message role="assistant"><p>了解しました。</p></Message>
</Story>

<Story
  asChild
  name="Kinds"
  parameters={{ docs: { description: { story: 'The four kinds of message.' } } }}
>
  <div class="flex max-w-[960px] flex-col gap-3">
    <Message role="user">Durable Objects のアラーム、来週の発表用にまとめておいて</Message>
    <Message role="thinking">research に論文側を頼んでくる。</Message>
    <Message role="assistant">
      <p>ここまでの材料でざっくり骨組みを作りました。</p>
    </Message>
    <Message role="peer" from={research}>
      <p>関連する論文を3件見つけました。要約を添えて返します。</p>
    </Message>
  </div>
</Story>

<Story
  asChild
  name="Conversation"
  parameters={{
    docs: {
      description: {
        story:
          'A turn as the design lays it out: the user asks, the agent says what it is doing, calls a peer agent, and replies. The last thinking pill is the latest, so it alone shows the typing dots.',
      },
    },
  }}
>
  <div class="flex max-w-[960px] flex-col gap-3">
    <Message role="user">Durable Objects のアラーム、来週の発表用にまとめておいて</Message>
    <div class="flex max-w-[560px] flex-col items-start gap-2">
      <Message role="thinking">research に論文側を頼んでくる。</Message>
      <ToolCall
        class="w-full"
        name="contact_agent"
        summary="research · 返信あり"
        state="done"
        durationMs={38_000}
        args={{ target: 'research', message: '論文側の調査をお願い' }}
        result="関連する論文を3件見つけました。要約を添えて返します。"
      />
      <Message role="peer" from={research}>
        <p>関連する論文を3件見つけました。要約を添えて返します。</p>
      </Message>
    </div>
    <Message role="assistant" class="mt-4">
      <p>ここまでの材料でざっくり骨組みを作りました。</p>
      <p><strong>アラームの基本</strong></p>
      <ul>
        <li>
          <strong>1オブジェクト1アラーム</strong>：<code>setAlarm()</code> で次の時刻を上書きする。
        </li>
        <li><strong>少なくとも1回</strong>：失敗すると指数バックオフで再実行される。</li>
        <li><strong>復旧に使う</strong>：Kodama は中断した run をアラームで拾い直している。</li>
      </ul>
      <p>明日の朝 9 時に、公式の変更履歴と突き合わせた版を出します。</p>
    </Message>
    <Message role="thinking" typing class="mt-4">公式の変更履歴と突き合わせ中</Message>
  </div>
</Story>

<Story
  asChild
  name="Streaming"
  parameters={{
    docs: {
      description: {
        story:
          'While a reply is still arriving, a caret blinks after its last block; it holds still under reduced motion.',
      },
    },
  }}
>
  <Message role="assistant" streaming>
    <p>アラームは 1 オブジェクトにつき 1 つで、<code>setAlarm()</code> で次の時刻を</p>
  </Message>
</Story>
