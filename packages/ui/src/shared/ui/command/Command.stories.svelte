<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import CommandRoot from './Command.svelte'
  import * as Command from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Command',
    component: CommandRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A list the user filters by typing (bits-ui Command): **Input** filters by label, arrow keys move, Enter picks, and **Empty** shows when nothing matches. **Group** adds a muted heading and **Separator** a line between groups. The current value has a check and a heavier weight. Inside a Popover it makes the Combobox; for a short list, use Select. Source: `design/components/Select`.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <div class="w-[260px] max-w-full rounded-xl border border-border bg-popover">
    <Command.Root>
      <Command.Input placeholder="検索" aria-label="エージェントを検索" />
      <Command.List>
        <Command.Empty>一致するものがありません</Command.Empty>
        {#each ['assistant', 'research', 'scheduler'] as name (name)}
          <Command.Item value={name}>{name}</Command.Item>
        {/each}
      </Command.List>
    </Command.Root>
  </div>
</Story>
