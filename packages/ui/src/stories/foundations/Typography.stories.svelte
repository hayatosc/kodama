<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  const { Story } = defineMeta({
    title: 'Foundations/Typography',
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'The text styles, from page titles down to UUID prefixes. Text is set in Gen Interface JP (Display for headings) and Geist Mono, with only two weights, 400 and 600. The samples are real Japanese UI copy, because the product speaks Japanese and line height is tuned for it. Source: `design/README.md`, section タイポグラフィ.',
        },
      },
    },
  })

  /** A text style: its class, its metrics, where it is used, and a sample of real UI copy. */
  type TextStyle = { name: string; spec: string; use: string; sample: string }

  const styles: TextStyle[] = [
    {
      name: 'type-2xl',
      spec: '24/32 · 600 · Display',
      use: 'Page titles on settings and empty states.',
      sample: 'エージェントを作成',
    },
    {
      name: 'type-lg',
      spec: '18/28 · 600 · Display',
      use: 'The main agent’s name and pane headings.',
      sample: 'assistant',
    },
    {
      name: 'type-base',
      spec: '16/24 · 400',
      use: 'The UI default: list names, buttons, inputs.',
      sample: '朝の要約を作成しました',
    },
    {
      name: 'type-base-semibold',
      spec: '16/24 · 600',
      use: 'Button labels, the selected row, names.',
      sample: '新しいエージェント',
    },
    {
      name: 'type-prose',
      spec: '16/28 · 400',
      use: 'Conversation text. The taller line keeps Japanese readable.',
      sample:
        '昨日の夜に届いた論文を読んで、要点を三つにまとめました。research にも論文側の確認を頼んであります。',
    },
    {
      name: 'type-sm',
      spec: '14/20 · 400',
      use: 'Dense parts: menus, settings rows, tabs, a list row’s second line.',
      sample: 'web_search を 2 回実行',
    },
    {
      name: 'type-sm-semibold',
      spec: '14/20 · 600',
      use: 'Emphasis inside dense parts.',
      sample: 'ツール',
    },
    {
      name: 'type-xs',
      spec: '12/16 · 400',
      use: 'Times, badges, small labels.',
      sample: '2分前',
    },
    {
      name: 'mono-sm',
      spec: '14/20 · Geist Mono',
      use: 'Tool arguments and results, configuration JSON.',
      sample: '{ "query": "kodama" }',
    },
    {
      name: 'mono-xs',
      spec: '12/16 · Geist Mono',
      use: 'UUID prefixes (first 8 characters) and durations.',
      sample: '3f9a1c2e · 1.2s',
    },
  ]
</script>

<Story
  name="Scale"
  parameters={{
    docs: {
      description: {
        story:
          'Left: the class to write, its size/line height and weight, and where it belongs. Right: a sample in that style.',
      },
    },
  }}
>
  <dl class="grid max-w-4xl grid-cols-[15rem_1fr] gap-x-8 gap-y-6">
    {#each styles as style (style.name)}
      <dt class="flex flex-col gap-0.5">
        <code class="mono-xs">{style.name}</code>
        <span class="text-xs text-muted-foreground">{style.spec}</span>
        <span class="text-xs text-muted-foreground">{style.use}</span>
      </dt>
      <dd class={style.name}>{style.sample}</dd>
    {/each}
  </dl>
</Story>
