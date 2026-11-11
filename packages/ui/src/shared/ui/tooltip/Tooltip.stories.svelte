<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import CopyIcon from '@lucide/svelte/icons/copy'
  import SettingsIcon from '@lucide/svelte/icons/settings'
  import * as Tooltip from './index.js'
  import TooltipContent from './tooltip-content.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Tooltip',
    component: TooltipContent,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A short hint shown on hover, keyboard focus, or long press, through interest invokers (`interestfor`) and a `popover="hint"`; the interestfor polyfill loads only where they are missing. It sits above the trigger and flips below at the viewport edge, Esc dismisses it, and the pointer can move onto it. A hint that repeats the trigger\'s name adds nothing for screen readers; otherwise it becomes the trigger\'s description, or its name when the trigger has none. Never put anything the user must read or operate in a tooltip: that belongs in a Popover or on the page.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Tooltip.Root>
    <Tooltip.Trigger>
      <CopyIcon strokeWidth={1.75} aria-hidden="true" />
      コピー
    </Tooltip.Trigger>
    <Tooltip.Content>クリップボードにリンクをコピーします</Tooltip.Content>
  </Tooltip.Root>
</Story>

<Story
  name="Icon button"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'An icon-only button with no `aria-label`: the tooltip becomes its accessible name through `aria-labelledby`.',
      },
    },
  }}
>
  <Tooltip.Root>
    <Tooltip.Trigger variant="ghost" size="icon">
      <SettingsIcon strokeWidth={1.75} aria-hidden="true" />
    </Tooltip.Trigger>
    <Tooltip.Content>設定</Tooltip.Content>
  </Tooltip.Root>
</Story>
