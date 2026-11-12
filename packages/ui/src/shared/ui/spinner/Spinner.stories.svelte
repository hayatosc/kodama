<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Button } from '../button/index.js'
  import Spinner from './Spinner.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Spinner',
    component: Spinner,
    tags: ['autodocs'],
    args: { label: '読み込み中' },
    parameters: {
      docs: {
        description: {
          component:
            'A ring that turns while work of unknown length runs, on an indeterminate native `<progress>`, so screen readers announce a busy progress bar with its `label`. It takes the text color and is 16px; set `--spinner-size` for another size. Under a reduced-motion request it turns slowly instead of stopping. For work with a known length, use Progress.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let saving = $state(false)

  function save(): void {
    saving = true
    setTimeout(() => (saving = false), 2000)
  }
</script>

<Story name="Default" />

<Story name="Sizes" asChild>
  <div class="flex items-center gap-4 text-foreground">
    <Spinner />
    <Spinner class="[--spinner-size:24px]" />
    <Spinner class="text-muted-foreground [--spinner-size:32px] [--spinner-thickness:3px]" />
  </div>
</Story>

<Story
  name="In a button"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'While saving, the button is disabled, shows the spinner, and says what it is doing; the spinner itself is hidden, since the label already says it.',
      },
    },
  }}
>
  <Button onclick={save} disabled={saving}>
    {#if saving}<Spinner aria-hidden="true" />保存しています{:else}保存{/if}
  </Button>
</Story>
