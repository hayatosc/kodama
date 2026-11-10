<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import CodeBlock from './CodeBlock.svelte'
  import Prose from './Prose.svelte'

  const { Story } = defineMeta({
    title: 'Kodama/Prose',
    component: Prose,
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'The look of Markdown inside an agent’s bubble: 16/28 body text, two heading levels, lists, links in live, inline and fenced code, quotes, and tables. It styles the elements it is given and never parses Markdown or takes HTML; the Streamdown port will render into it. While a reply is streaming, a caret blinks after the last block. Source: `design/components/Prose`.',
        },
      },
    },
  })
</script>

<Story name="Everything" asChild>
  <div class="max-w-[560px]">
    <Prose>
      <h3>アラームの再試行</h3>
      <p>
        Durable Objects のアラームは<strong>少なくとも 1 回</strong>実行されます。失敗すると
        <a href="https://developers.cloudflare.com/durable-objects/api/alarms/">指数バックオフ</a>
        で最大 6 回まで再試行されます。
      </p>
      <ul>
        <li><code>setAlarm()</code> は 1 つのオブジェクトに 1 つだけ</li>
        <li>再試行の間も <code>alarm()</code> は同じ引数で呼ばれる</li>
      </ul>
      <h4>実装の注意</h4>
      <ol>
        <li>処理を冪等にする</li>
        <li>失敗を記録してから例外を投げる</li>
      </ol>
      <blockquote>アラームは正確な時刻を保証しません。数秒の遅れを見込んでください。</blockquote>
      <CodeBlock
        language="ts"
        code={`async alarm() {\n  await this.drain()\n  await this.ctx.storage.setAlarm(Date.now() + 60_000)\n}`}
      />
      <div class="table-scroll">
        <table>
          <thead><tr><th>回数</th><th>待ち時間</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>2 秒</td></tr>
            <tr><td>2</td><td>4 秒</td></tr>
            <tr><td>6</td><td>64 秒</td></tr>
          </tbody>
        </table>
      </div>
      <hr />
      <p>来週の発表用には、この表と再試行の図をまとめておきます。</p>
    </Prose>
  </div>
</Story>

<Story
  name="Streaming"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'While the reply arrives, a caret blinks after the last block, even inside a list.',
      },
    },
  }}
>
  <div class="flex max-w-[560px] flex-col gap-6">
    <Prose streaming>
      <p>要点を三つにまとめると、まずアラームは</p>
    </Prose>
    <Prose streaming>
      <p>要点は三つです。</p>
      <ul>
        <li>少なくとも 1 回実行される</li>
        <li>失敗すると再試行される</li>
      </ul>
    </Prose>
  </div>
</Story>
