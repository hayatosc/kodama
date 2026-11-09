<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  const { Story } = defineMeta({
    title: 'Foundations/Colors',
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'Every color token in the design system, grouped by job. The screen itself stays black and white; color is reserved for agents (their birds) and for status. Switch the theme in the toolbar to compare light and dark. Source: `design/README.md`, section 色.',
        },
      },
    },
  })

  /** One swatch: the token, the class to write, and where it belongs. */
  type Swatch = { token: string; usage: string; use: string }

  /** A group of related tokens with the rule that governs them. */
  type Group = { title: string; rule: string; swatches: Swatch[] }

  /** Working-agent colors share one description; only their names differ. */
  const agentHues = [
    'orange',
    'yellow',
    'green',
    'teal',
    'sky',
    'blue',
    'violet',
    'plum',
    'pink',
    'red',
    'brown',
  ]

  const groups: Group[] = [
    {
      title: 'Surfaces',
      rule: 'Panes are told apart by surface tone and a 1px border, not by shadows.',
      swatches: [
        { token: 'background', usage: 'bg-background', use: 'Page and conversation pane.' },
        { token: 'sidebar', usage: 'bg-sidebar', use: 'Agent list on the left.' },
        { token: 'card', usage: 'bg-card', use: 'Settings cards and other raised panels.' },
        { token: 'popover', usage: 'bg-popover', use: 'Menus, popovers, and dialogs.' },
        {
          token: 'muted',
          usage: 'bg-muted',
          use: 'Selected row, agent message bubble, thinking pill.',
        },
        { token: 'accent', usage: 'bg-accent', use: 'Hover background.' },
      ],
    },
    {
      title: 'Text and lines',
      rule: 'Body text uses foreground and supporting text uses muted-foreground; both stay readable on every surface above.',
      swatches: [
        { token: 'foreground', usage: 'text-foreground', use: 'Body text and names.' },
        {
          token: 'muted-foreground',
          usage: 'text-muted-foreground',
          use: 'Times, slugs, model names, placeholders.',
        },
        {
          token: 'border',
          usage: 'border-border',
          use: 'Decorative dividers. Never the only outline of a control.',
        },
        {
          token: 'input',
          usage: 'border-input',
          use: 'Outline of inputs and secondary buttons (3:1 contrast).',
        },
        { token: 'ring', usage: 'ring-ring', use: 'Focus ring: 2px, offset 2px.' },
        {
          token: 'primary',
          usage: 'bg-primary',
          use: 'Alias of foreground. Primary buttons and the user’s message pill invert per theme.',
        },
      ],
    },
    {
      title: 'Status',
      rule: 'Only three status colors exist, and each always comes with a word or an icon. Success stays uncolored on purpose.',
      swatches: [
        { token: 'live', usage: 'text-live', use: 'Active agent, new replies, links.' },
        { token: 'live-soft', usage: 'bg-live-soft', use: 'Background of the live badge.' },
        { token: 'running', usage: 'text-running', use: 'Work in progress; its dot blinks.' },
        {
          token: 'running-soft',
          usage: 'bg-running-soft',
          use: 'Background of the running badge.',
        },
        {
          token: 'destructive',
          usage: 'text-destructive',
          use: 'Failures and destructive actions.',
        },
        {
          token: 'destructive-soft',
          usage: 'bg-destructive-soft',
          use: 'Background of error badges and destructive buttons.',
        },
      ],
    },
    {
      title: 'Agents',
      rule: 'Each agent keeps one color for life, derived from its UUID. Use it only on the bird and the birdhouse flag, never on text or borders, and always next to the agent’s name.',
      swatches: [
        ...agentHues.map((hue) => ({
          token: `agent-${hue}`,
          usage: `bg-agent-${hue}`,
          use: 'A working agent.',
        })),
        {
          token: 'agent-ink',
          usage: 'bg-agent-ink',
          use: 'Reserved for the main agent (assistant).',
        },
        {
          token: 'agent-system',
          usage: 'bg-agent-system',
          use: 'Dedicated system agents, shown in gray.',
        },
      ],
    },
    {
      title: 'Bird and birdhouse',
      rule: 'Bird colors are identical in both themes, so an agent looks the same everywhere. The house-* grays follow the theme and draw only the large shared birdhouse.',
      swatches: [
        { token: 'bird-face', usage: 'var(--bird-face)', use: 'Face and belly.' },
        { token: 'bird-eye', usage: 'var(--bird-eye)', use: 'Eyes.' },
        { token: 'bird-blush', usage: 'var(--bird-blush)', use: 'Cheeks.' },
        { token: 'bird-beak', usage: 'var(--bird-beak)', use: 'Beak.' },
        { token: 'bird-beak-top', usage: 'var(--bird-beak-top)', use: 'Upper beak highlight.' },
        { token: 'bird-feet', usage: 'var(--bird-feet)', use: 'Feet.' },
        { token: 'bird-bill-line', usage: 'var(--bird-bill-line)', use: 'Line between the bills.' },
        { token: 'house-wood', usage: 'var(--house-wood)', use: 'Birdhouse front wall.' },
        { token: 'house-wood-side', usage: 'var(--house-wood-side)', use: 'Birdhouse side wall.' },
        { token: 'house-roof', usage: 'var(--house-roof)', use: 'Roof, front.' },
        { token: 'house-roof-side', usage: 'var(--house-roof-side)', use: 'Roof, side.' },
        { token: 'house-post', usage: 'var(--house-post)', use: 'Post the house stands on.' },
        { token: 'house-hole', usage: 'var(--house-hole)', use: 'Entrance hole.' },
      ],
    },
  ]
</script>

<Story
  name="Palette"
  parameters={{
    docs: {
      description: {
        story:
          'Each swatch shows the token, the class or variable to write, and where the token belongs.',
      },
    },
  }}
>
  <div class="flex max-w-5xl flex-col gap-10">
    {#each groups as group (group.title)}
      <section class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <h2 class="type-lg">{group.title}</h2>
          <p class="max-w-3xl text-sm text-muted-foreground">{group.rule}</p>
        </div>
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-5">
          {#each group.swatches as swatch (swatch.token)}
            <li class="flex flex-col gap-1">
              <span
                class="mb-1 h-14 rounded-lg border border-border shadow-sm"
                style:background={`var(--${swatch.token})`}
              ></span>
              <span class="type-sm-semibold">{swatch.token}</span>
              <code class="mono-xs text-muted-foreground">{swatch.usage}</code>
              <span class="text-xs text-muted-foreground">{swatch.use}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</Story>
