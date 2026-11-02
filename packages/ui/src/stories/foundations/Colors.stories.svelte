<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  const { Story } = defineMeta({
    title: 'Foundations/Colors',
    parameters: { layout: 'padded' },
  })

  /** Token names grouped as design/README.md — 色 describes them. */
  const groups: { title: string; note: string; tokens: string[] }[] = [
    {
      title: '面',
      note: '一覧は sidebar、会話は background、浮く面は card / popover。選択中は muted、ホバーは accent。',
      tokens: ['background', 'sidebar', 'card', 'popover', 'muted', 'accent'],
    },
    {
      title: '文字と線',
      note: '補助情報は muted-foreground。操作部品の枠は input（3:1）、border は装飾の罫線。',
      tokens: ['foreground', 'muted-foreground', 'border', 'input', 'ring', 'primary'],
    },
    {
      title: '状態',
      note: '状態の色は 3 つだけ。必ず語かアイコンと組にする。',
      tokens: ['live', 'live-soft', 'running', 'running-soft', 'destructive', 'destructive-soft'],
    },
    {
      title: 'エージェント',
      note: '鳥と巣箱の旗にだけ使い、文字や枠には使わない。ink はメイン、system はシステム用。',
      tokens: [
        'agent-orange',
        'agent-yellow',
        'agent-green',
        'agent-teal',
        'agent-sky',
        'agent-blue',
        'agent-violet',
        'agent-plum',
        'agent-pink',
        'agent-red',
        'agent-brown',
        'agent-ink',
        'agent-system',
      ],
    },
    {
      title: '鳥と巣箱',
      note: '鳥の色は両テーマで同じ。house-* は大きな巣箱だけに使う。',
      tokens: [
        'bird-face',
        'bird-eye',
        'bird-blush',
        'bird-beak',
        'bird-beak-top',
        'bird-feet',
        'bird-bill-line',
        'house-wood',
        'house-wood-side',
        'house-roof',
        'house-roof-side',
        'house-post',
        'house-hole',
      ],
    },
  ]
</script>

<Story name="Palette">
  <div class="flex max-w-5xl flex-col gap-8">
    {#each groups as group (group.title)}
      <section class="flex flex-col gap-3">
        <div>
          <h2 class="type-lg">{group.title}</h2>
          <p class="text-sm text-muted-foreground">{group.note}</p>
        </div>
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {#each group.tokens as token (token)}
            <li class="flex flex-col gap-1.5">
              <span
                class="h-14 rounded-lg border border-border shadow-sm"
                style:background={`var(--${token})`}
              ></span>
              <span class="mono-xs">{token}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</Story>
