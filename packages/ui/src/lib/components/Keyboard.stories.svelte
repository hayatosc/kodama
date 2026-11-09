<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Keyboard from './Keyboard.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Keyboard',
    component: Keyboard,
    tags: ['autodocs'],
    args: { keys: '⏎', label: '送信' },
    parameters: {
      docs: {
        description: {
          component:
            'A key hint: the key and, to its right, what it does. Show ⌘ on the Mac and Ctrl elsewhere. Source: `design/components/Kbd`.',
        },
      },
    },
  })

  const hints = [
    { keys: '⏎', label: '送信' },
    { keys: '⇧ ⏎', label: '改行' },
    { keys: 'Tab', label: 'キューに追加' },
    { keys: 'Esc', label: '停止' },
  ]
</script>

<Story name="Key with label" />

<Story name="Key only" args={{ keys: '⌘ K', label: undefined }} />

<Story
  name="Composer hints"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Several hints in a row, separated by a 1px divider, as the Composer shows them while an agent is running.',
      },
    },
  }}
>
  <div class="flex items-center gap-3">
    {#each hints as hint, index (hint.keys)}
      {#if index > 0}<span aria-hidden="true" class="h-3 w-px bg-border"></span>{/if}
      <Keyboard keys={hint.keys} label={hint.label} />
    {/each}
  </div>
</Story>
