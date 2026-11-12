<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Popover from './index.js'
  import PopoverContent from './PopoverContent.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Popover',
    component: PopoverContent,
    tags: ['autodocs'],
    argTypes: {
      align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
    },
    args: { align: 'start' },
    parameters: {
      docs: {
        description: {
          component:
            'Content that opens over the page from a button, on the native Popover API: the browser puts it in the top layer and closes it on Esc and a click outside, and focus returns to the trigger. It sits below the trigger, lined up by `align`, and flips at the viewport edge. Put `data-autofocus` on the element that should take focus when it opens.',
        },
      },
    },
  })
</script>

<Story name="Default">
  {#snippet template(args)}
    <Popover.Root>
      <Popover.Trigger>詳細</Popover.Trigger>
      <Popover.Content {...args} class="p-3 text-sm"
        >最終更新は 11 月 10 日 14:32 です</Popover.Content
      >
    </Popover.Root>
  {/snippet}
</Story>
