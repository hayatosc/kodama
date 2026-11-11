<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import BoldIcon from '@lucide/svelte/icons/bold'
  import ItalicIcon from '@lucide/svelte/icons/italic'
  import TextAlignCenterIcon from '@lucide/svelte/icons/text-align-center'
  import TextAlignEndIcon from '@lucide/svelte/icons/text-align-end'
  import TextAlignStartIcon from '@lucide/svelte/icons/text-align-start'
  import UnderlineIcon from '@lucide/svelte/icons/underline'
  import * as ToggleGroup from './index.js'
  import ToggleGroupRoot from './toggle-group.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/ToggleGroup',
    component: ToggleGroupRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Toggle buttons that belong together, in a named group. `type="multiple"` lets any number be pressed, like text styles; `type="single"` keeps exactly one pressed, like alignment, and pressing it again keeps it pressed. Each item announces its own pressed state and stays a Tab stop.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let styles = $state(['bold'])
  let align = $state('start')
</script>

<Story name="Multiple" asChild>
  <ToggleGroup.Root type="multiple" aria-label="文字の書式" bind:value={styles}>
    <ToggleGroup.Item value="bold" aria-label="太字">
      <BoldIcon strokeWidth={1.75} aria-hidden="true" />
    </ToggleGroup.Item>
    <ToggleGroup.Item value="italic" aria-label="斜体">
      <ItalicIcon strokeWidth={1.75} aria-hidden="true" />
    </ToggleGroup.Item>
    <ToggleGroup.Item value="underline" aria-label="下線">
      <UnderlineIcon strokeWidth={1.75} aria-hidden="true" />
    </ToggleGroup.Item>
  </ToggleGroup.Root>
</Story>

<Story name="Single" asChild>
  <ToggleGroup.Root type="single" variant="outline" aria-label="配置" bind:value={align}>
    <ToggleGroup.Item value="start" aria-label="左揃え">
      <TextAlignStartIcon strokeWidth={1.75} aria-hidden="true" />
    </ToggleGroup.Item>
    <ToggleGroup.Item value="center" aria-label="中央揃え">
      <TextAlignCenterIcon strokeWidth={1.75} aria-hidden="true" />
    </ToggleGroup.Item>
    <ToggleGroup.Item value="end" aria-label="右揃え">
      <TextAlignEndIcon strokeWidth={1.75} aria-hidden="true" />
    </ToggleGroup.Item>
  </ToggleGroup.Root>
</Story>
