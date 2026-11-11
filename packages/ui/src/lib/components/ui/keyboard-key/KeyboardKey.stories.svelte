<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Button } from '../button/index.js'
  import * as KeyboardKey from './index.js'
  import KeyboardKeyRoot from './keyboard-key.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/KeyboardKey',
    component: KeyboardKeyRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A key in a native `<kbd>`. **KeyboardKey.Group** wraps the keys of one combination in an outer `<kbd>`, as the HTML spec nests them. Show ⌘ on the Mac and Ctrl elsewhere. Source: `design/components/Kbd`.',
        },
      },
    },
  })

  const hints = [
    { key: '⏎', label: '送信' },
    { key: '⇧ ⏎', label: '改行' },
    { key: 'Esc', label: '閉じる' },
  ]
</script>

<Story name="Default">K</Story>

<Story
  name="Group"
  asChild
  parameters={{
    docs: { description: { story: 'The keys of one shortcut, pressed together.' } },
  }}
>
  <div class="flex flex-col items-start gap-3">
    <KeyboardKey.Group>
      <KeyboardKey.Root>⌘</KeyboardKey.Root>
      <KeyboardKey.Root>K</KeyboardKey.Root>
    </KeyboardKey.Group>
    <KeyboardKey.Group>
      <KeyboardKey.Root>Ctrl</KeyboardKey.Root>
      <KeyboardKey.Root>Shift</KeyboardKey.Root>
      <KeyboardKey.Root>P</KeyboardKey.Root>
    </KeyboardKey.Group>
  </div>
</Story>

<Story
  name="In a sentence"
  asChild
  parameters={{
    docs: { description: { story: 'Keys sit on the text’s line inside running copy.' } },
  }}
>
  <p class="text-sm">
    <KeyboardKey.Group
      ><KeyboardKey.Root>⌘</KeyboardKey.Root><KeyboardKey.Root>K</KeyboardKey.Root
      ></KeyboardKey.Group
    > でコマンドパレットを開きます。
  </p>
</Story>

<Story
  name="With description"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Hints for the keys that work right now: each key with what it does to its right, in muted extra-small text, and several hints separated by a 1px divider.',
      },
    },
  }}
>
  <div class="flex items-center gap-3">
    {#each hints as hint, index (hint.key)}
      {#if index > 0}<span aria-hidden="true" class="h-3 w-px bg-border"></span>{/if}
      <span class="inline-flex items-center gap-1.5">
        <KeyboardKey.Root>{hint.key}</KeyboardKey.Root>
        <span class="text-xs text-muted-foreground">{hint.label}</span>
      </span>
    {/each}
  </div>
</Story>

<Story
  name="In a button"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A shortcut inside the button it triggers. `aria-keyshortcuts` tells assistive technology about the shortcut.',
      },
    },
  }}
>
  <Button variant="secondary" aria-keyshortcuts="Meta+S">
    保存<KeyboardKey.Group
      ><KeyboardKey.Root>⌘</KeyboardKey.Root><KeyboardKey.Root>S</KeyboardKey.Root
      ></KeyboardKey.Group
    >
  </Button>
</Story>
