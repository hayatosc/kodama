<script lang="ts">
  import Message from '../../lib/components/conversation/Message.svelte'
  import ToolCall from '../../lib/components/conversation/ToolCall.svelte'
  import { cn } from '#lib/utils.js'
  import { workingAgents } from '../mock.js'

  let { mobile = false }: { mobile?: boolean } = $props()

  const research = workingAgents[0]
</script>

<!-- The mock conversation the screen stories share: one turn with the main agent, still running. -->
<Message role="user" class={cn(mobile && 'max-w-[85%]')}
  >Durable Objects のアラーム、来週の発表用にまとめておいて</Message
>
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
  {#if research && !mobile}
    <Message
      role="peer"
      from={{ slug: research.slug, agentId: research.agentId, hop: 1, avatar: research.avatar }}
    >
      <p>関連する論文を 3 件見つけました。要約を添えて返します。</p>
    </Message>
  {/if}
  <Message role="assistant">
    <p>ここまでの材料でざっくり骨組みを作りました。</p>
    <h3>アラームの基本</h3>
    <ul>
      <li>
        <strong>1 オブジェクト 1 アラーム</strong>：<code>setAlarm()</code> で次の時刻を上書きする。
      </li>
      <li><strong>少なくとも 1 回</strong>：失敗すると指数バックオフで再実行される。</li>
      <li><strong>復旧に使う</strong>：Kodama は中断した run をアラームで拾い直している。</li>
    </ul>
    <p>明日の朝 9 時に、公式の変更履歴と突き合わせた版を出します。</p>
  </Message>
  <Message role="thinking" typing>公式の変更履歴と突き合わせ中</Message>
</div>
