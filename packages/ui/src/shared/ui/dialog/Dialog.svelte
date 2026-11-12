<script lang="ts">
  import { setDialogState } from './context.js'
  import type { Snippet } from 'svelte'

  let {
    open = $bindable(false),
    children,
  }: {
    /** Whether the dialog is open; bind it to open or close the dialog from code. */
    open?: boolean
    children?: Snippet
  } = $props()

  const id = $props.id()
  let labelled = $state(false)
  let described = $state(false)

  setDialogState({
    id,
    get open() {
      return open
    },
    set open(next) {
      open = next
    },
    get labelled() {
      return labelled
    },
    set labelled(next) {
      labelled = next
    },
    get described() {
      return described
    },
    set described(next) {
      described = next
    },
  })
</script>

{@render children?.()}
