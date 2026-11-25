<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Prose from './Prose.svelte'
  import ProseCodeBlock from './ProseCodeBlock.svelte'
  import ProseTable from './ProseTable.svelte'

  const { Story } = defineMeta({
    title: 'Kodama/Prose',
    component: Prose,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'The look of Markdown inside an agent’s reply: 16/28 text with 8px between blocks, h3 and h4 headings (h1 and h2 look like h3), lists, links in the live color, inline code, code blocks with their language and a copy button, quotes, and tables that scroll sideways when too wide. It styles the elements it is given; turning Markdown into elements, safely and while it streams, comes with Streamdown after the mockups. Source: `design/components/Prose`.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Prose class="max-w-[560px]">
    <p>Durable Objects には <strong>1 オブジェクトにつき 1 つ</strong>のアラームを設定できます。</p>
  </Prose>
</Story>

<Story
  asChild
  name="Every element"
  parameters={{
    docs: { description: { story: 'Each element Markdown renders, inside an agent’s bubble.' } },
  }}
>
  <div class="max-w-[560px] rounded-2xl bg-muted px-3.5 py-2.5">
    <Prose>
      <h3>アラームの基本</h3>
      <p>
        Durable Objects には <strong>1 オブジェクトにつき 1 つ</strong>のアラームを設定できます。<a
          href="https://developers.cloudflare.com/durable-objects/api/alarms/">公式ドキュメント</a
        >に詳しい説明があります。
      </p>
      <ul>
        <li><code>setAlarm()</code> で次の時刻を上書きする</li>
        <li>失敗すると指数バックオフで再実行される</li>
      </ul>
      <ol>
        <li>状態を保存する</li>
        <li>アラームを設定する</li>
        <li>ハンドラで続きを処理する</li>
      </ol>
      <h4>設定の例</h4>
      <ProseCodeBlock language="ts"
        ><span class="text-live">await</span> ctx.storage.<span class="text-live">setAlarm</span
        >(Date.now() + <span class="text-destructive">60_000</span>)</ProseCodeBlock
      >
      <blockquote>アラームは少なくとも 1 回実行されます。ちょうど 1 回ではありません。</blockquote>
      <ProseTable>
        <thead>
          <tr><th>項目</th><th>値</th></tr>
        </thead>
        <tbody>
          <tr><td>再試行</td><td>最大 6 回</td></tr>
          <tr><td>初回の待ち</td><td>2 秒</td></tr>
        </tbody>
      </ProseTable>
    </Prose>
  </div>
</Story>

<Story
  asChild
  name="Streaming"
  parameters={{
    docs: {
      description: {
        story:
          'While the reply streams, a caret follows the last block. A code block stays plain until its fence closes.',
      },
    },
  }}
>
  <div class="max-w-[560px] rounded-2xl bg-muted px-3.5 py-2.5">
    <Prose streaming>
      <h3>アラームの基本</h3>
      <p>Durable Objects には 1 オブジェクトにつき 1 つのアラームを</p>
    </Prose>
  </div>
</Story>
