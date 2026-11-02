<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  const { Story } = defineMeta({
    title: 'Foundations/Layout',
    parameters: { layout: 'padded' },
  })

  /** Spacing in Tailwind steps (4px each), as design/README.md — 余白とレイアウト names them. */
  const spacing = [1, 2, 3, 4, 6, 8, 12]

  /** Radius with what design/README.md — 角丸と影 assigns to each. */
  const radii: { name: string; use: string }[] = [
    { name: 'rounded-sm', use: '4px' },
    { name: 'rounded-md', use: '6px · バッジ' },
    { name: 'rounded-lg', use: '8px · ボタン、入力、ツール呼び出し' },
    { name: 'rounded-xl', use: '12px · 一覧の行、設定カード、ポップオーバー' },
    { name: 'rounded-2xl', use: '16px · 吹き出し、メインの特別枠' },
    { name: 'rounded-full', use: 'Composer、ユーザーのピル、丸ボタン' },
  ]
</script>

<Story name="Spacing">
  <ul class="flex flex-col gap-3">
    {#each spacing as step (step)}
      <li class="flex items-center gap-4">
        <span class="mono-xs w-24">spacing-{step}</span>
        <span class="h-4 rounded-sm bg-foreground" style:width={`${step * 4}px`}></span>
        <span class="text-xs text-muted-foreground">{step * 4}px</span>
      </li>
    {/each}
  </ul>
</Story>

<Story name="Radius">
  <ul class="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
    {#each radii as radius (radius.name)}
      <li class="flex flex-col gap-2">
        <span class={['h-16 border border-input bg-muted', radius.name]}></span>
        <span class="mono-xs">{radius.name}</span>
        <span class="text-xs text-muted-foreground">{radius.use}</span>
      </li>
    {/each}
  </ul>
</Story>

<Story name="Shadow">
  <div class="flex gap-8 bg-sidebar p-8">
    <div class="flex size-40 flex-col justify-end rounded-2xl bg-card p-4 shadow-sm">
      <span class="mono-xs">shadow-sm</span>
      <span class="text-xs text-muted-foreground">ボタン、メインの特別枠</span>
    </div>
    <div class="flex size-40 flex-col justify-end rounded-2xl bg-card p-4 shadow-lg">
      <span class="mono-xs">shadow-lg</span>
      <span class="text-xs text-muted-foreground">Composer、浮く面</span>
    </div>
  </div>
</Story>
