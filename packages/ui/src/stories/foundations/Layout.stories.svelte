<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  const { Story } = defineMeta({
    title: 'Foundations/Layout',
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'Spacing, corner radius, and shadow. All three use Tailwind’s default scale unchanged, so `p-4` is 16px and `rounded-lg` is 8px exactly as the design specifies. Source: `design/README.md`, sections 余白とレイアウト and 角丸と影.',
        },
      },
    },
  })

  /** A spacing step in Tailwind units (4px each) and where the design uses it. */
  const spacing: { step: number; use: string }[] = [
    { step: 1, use: 'Tightest gaps, such as a badge dot and its label.' },
    { step: 2, use: 'Between consecutive bubbles from the same speaker.' },
    { step: 3, use: 'Also between same-speaker bubbles; row padding.' },
    { step: 4, use: 'Where the speaker changes; standard panel padding.' },
    { step: 6, use: 'Between sections of a panel.' },
    { step: 8, use: 'Page padding on wide screens.' },
    { step: 12, use: 'Empty states and page-level breathing room.' },
  ]

  /** A radius class, its size, and the parts that use it. */
  const radii: { name: string; size: string; use: string }[] = [
    { name: 'rounded-sm', size: '4px', use: 'Small inline marks.' },
    { name: 'rounded-md', size: '6px', use: 'Status badges.' },
    { name: 'rounded-lg', size: '8px', use: 'Buttons, inputs, tool calls.' },
    { name: 'rounded-xl', size: '12px', use: 'List rows, settings cards, popovers.' },
    { name: 'rounded-2xl', size: '16px', use: 'Message bubbles and the main agent’s card.' },
    { name: 'rounded-full', size: 'pill', use: 'Composer, the user’s pill, round buttons.' },
  ]
</script>

<Story
  name="Spacing"
  parameters={{
    docs: {
      description: {
        story:
          'Spacing moves in 4px steps. Write the step in any spacing utility: `p-4`, `gap-4`, and `mt-4` are all 16px.',
      },
    },
  }}
>
  <ul class="flex flex-col gap-3">
    {#each spacing as { step, use } (step)}
      <li class="grid grid-cols-[6rem_3rem_4rem_1fr] items-center gap-4">
        <code class="mono-xs">spacing-{step}</code>
        <span class="text-xs text-muted-foreground">{step * 4}px</span>
        <span class="h-4 rounded-sm bg-foreground" style:width={`${step * 4}px`}></span>
        <span class="text-xs text-muted-foreground">{use}</span>
      </li>
    {/each}
  </ul>
</Story>

<Story
  name="Radius"
  parameters={{
    docs: {
      description: {
        story:
          'Larger, softer parts get larger radii: controls are 8px, rows and cards 12px, and bubbles 16px. Fully round shapes are kept for things that float or represent a person.',
      },
    },
  }}
>
  <ul class="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
    {#each radii as radius (radius.name)}
      <li class="flex flex-col gap-1">
        <span class={['mb-1 h-16 border border-input bg-muted', radius.name]}></span>
        <code class="mono-xs">{radius.name}</code>
        <span class="text-xs text-muted-foreground">{radius.size} · {radius.use}</span>
      </li>
    {/each}
  </ul>
</Story>

<Story
  name="Shadow"
  parameters={{
    docs: {
      description: {
        story:
          'There are only two shadows. Everything else is separated by surface tone and a 1px border, so a shadow always means the element sits above the page.',
      },
    },
  }}
>
  <div class="flex flex-wrap gap-8 bg-sidebar p-8">
    <div class="flex size-44 flex-col justify-end gap-0.5 rounded-2xl bg-card p-4 shadow-sm">
      <code class="mono-xs">shadow-sm</code>
      <span class="text-xs text-muted-foreground">Buttons and the main agent’s card.</span>
    </div>
    <div class="flex size-44 flex-col justify-end gap-0.5 rounded-2xl bg-card p-4 shadow-lg">
      <code class="mono-xs">shadow-lg</code>
      <span class="text-xs text-muted-foreground">
        The composer, popovers, menus, and other floating surfaces.
      </span>
    </div>
  </div>
</Story>
