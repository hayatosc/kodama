<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import CommandRoot from './Command.svelte'
  import * as Command from './index.js'
  import * as Popover from '../popover/index.js'
  import { regions } from './prefectures.js'

  const { Story } = defineMeta({
    title: 'Primitives/Command',
    component: CommandRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A list the user filters by typing (bits-ui Command): **Input** filters by label, arrow keys move, Enter picks, and **Empty** shows when nothing matches. **Group** adds a muted heading and **Separator** a line between groups. The current value has a check and a heavier weight. Inside a Popover it makes a combobox, shown in the Combobox stories; for a short list, use Select. Source: `design/components/Select`.',
        },
      },
    },
  })

  const prefectures = regions.flatMap((region) => region.prefectures)

  /** The trigger's classes: the 36px field trigger of design/components/Select. */
  const field = 'w-[220px] justify-between px-2.5 text-sm font-normal'
</script>

<script lang="ts">
  let flatOpen = $state(false)
  let flatValue = $state('')
  let groupedOpen = $state(false)
  let groupedValue = $state('大阪府')
</script>

<Story name="Default" asChild>
  <div class="w-[260px] rounded-xl border border-border bg-popover">
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

{#snippet trigger(valueId: string, value: string)}
  <span id={valueId} class={value ? 'truncate' : 'truncate text-muted-foreground'}>
    {value || '選択してください'}
  </span>
  <ChevronDownIcon class="text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
{/snippet}

<Story
  name="Combobox"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Popover and Command together pick one option from a long list. The trigger opens the popover with the search field focused; Esc or a click outside closes it and returns focus to the trigger.',
      },
    },
  }}
>
  <div class="flex flex-col gap-1.5">
    <span id="combobox-flat-label" class="text-sm font-semibold">都道府県</span>
    <Popover.Root bind:open={flatOpen}>
      <Popover.Trigger class={field} aria-labelledby="combobox-flat-label combobox-flat-value">
        {@render trigger('combobox-flat-value', flatValue)}
      </Popover.Trigger>
      <Popover.Content class="w-[260px] p-0">
        <Command.Root>
          <Command.Input placeholder="検索" aria-label="都道府県を検索" data-autofocus />
          <Command.List>
            <Command.Empty>一致するものがありません</Command.Empty>
            {#each prefectures as name (name)}
              <Command.Item
                value={name}
                checked={name === flatValue}
                onSelect={() => {
                  flatValue = name
                  flatOpen = false
                }}
              >
                {name}
              </Command.Item>
            {/each}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
  </div>
</Story>

<Story
  name="Combobox with groups"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Groups with a muted heading and a separator between them. Search covers every group; a group with no match hides.',
      },
    },
  }}
>
  <div class="flex flex-col gap-1.5">
    <span id="combobox-grouped-label" class="text-sm font-semibold">都道府県</span>
    <Popover.Root bind:open={groupedOpen}>
      <Popover.Trigger
        class={field}
        aria-labelledby="combobox-grouped-label combobox-grouped-value"
      >
        {@render trigger('combobox-grouped-value', groupedValue)}
      </Popover.Trigger>
      <Popover.Content class="w-[260px] p-0">
        <Command.Root>
          <Command.Input placeholder="検索" aria-label="都道府県を検索" data-autofocus />
          <Command.List>
            <Command.Empty>一致するものがありません</Command.Empty>
            {#each regions as region, index (region.name)}
              {#if index > 0}<Command.Separator />{/if}
              <Command.Group heading={region.name}>
                {#each region.prefectures as name (name)}
                  <Command.Item
                    value={name}
                    checked={name === groupedValue}
                    onSelect={() => {
                      groupedValue = name
                      groupedOpen = false
                    }}
                  >
                    {name}
                  </Command.Item>
                {/each}
              </Command.Group>
            {/each}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
  </div>
</Story>

<Story
  name="Combobox disabled"
  asChild
  parameters={{
    docs: { description: { story: 'A disabled trigger does not open, at 40% opacity.' } },
  }}
>
  <div class="flex flex-col gap-1.5">
    <span id="combobox-disabled-label" class="text-sm font-semibold">都道府県</span>
    <Popover.Root>
      <Popover.Trigger
        class={field}
        disabled
        aria-labelledby="combobox-disabled-label combobox-disabled-value"
      >
        {@render trigger('combobox-disabled-value', '東京都')}
      </Popover.Trigger>
      <Popover.Content class="w-[260px] p-0">
        <p class="p-2 text-sm text-muted-foreground">開けません</p>
      </Popover.Content>
    </Popover.Root>
  </div>
</Story>
