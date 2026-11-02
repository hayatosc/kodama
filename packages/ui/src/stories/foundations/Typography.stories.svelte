<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  const { Story } = defineMeta({
    title: 'Foundations/Typography',
    parameters: { layout: 'padded' },
  })

  /** The text styles tokens.css declares, with where design/README.md — タイポグラフィ uses each. */
  const styles: { name: string; use: string; sample: string }[] = [
    { name: 'type-2xl', use: '設定・空状態のページ見出し', sample: 'エージェントを作成' },
    { name: 'type-lg', use: 'メインの名前、ペインの見出し', sample: 'assistant' },
    {
      name: 'type-base',
      use: 'UI の既定（一覧の名前、ボタン、入力欄）',
      sample: '朝の要約を作成しました',
    },
    { name: 'type-base-semibold', use: 'ボタン、選択中の行、名前', sample: '新しいエージェント' },
    {
      name: 'type-prose',
      use: '会話本文（16/28）',
      sample:
        '昨日の夜に届いた論文を読んで、要点を三つにまとめました。research にも論文側の確認を頼んであります。',
    },
    {
      name: 'type-sm',
      use: 'メニュー、設定の行、タブ、一覧の 2 行目',
      sample: 'web_search を 2 回実行',
    },
    { name: 'type-sm-semibold', use: '密な部品の強調', sample: 'ツール' },
    { name: 'type-xs', use: '時刻、バッジ、小見出し', sample: '2分前' },
    { name: 'mono-sm', use: 'ツール引数・結果、設定 JSON', sample: '{ "query": "kodama" }' },
    { name: 'mono-xs', use: 'UUID の先頭 8 桁、所要時間', sample: '3f9a1c2e · 1.2s' },
  ]
</script>

<Story name="Scale">
  <dl class="grid max-w-4xl grid-cols-[12rem_1fr] gap-x-6 gap-y-5">
    {#each styles as style (style.name)}
      <dt class="flex flex-col">
        <span class="mono-xs">{style.name}</span>
        <span class="text-xs text-muted-foreground">{style.use}</span>
      </dt>
      <dd class={style.name}>{style.sample}</dd>
    {/each}
  </dl>
</Story>
