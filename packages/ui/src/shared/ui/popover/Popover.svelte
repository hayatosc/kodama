<script lang="ts">
  import { setPopoverState } from './context.js'
  import type { Snippet } from 'svelte'

  let {
    open = $bindable(false),
    children,
  }: {
    /** Whether the popover is open; bind it to close the popover from code, such as on a choice. */
    open?: boolean
    children?: Snippet
  } = $props()

  const id = $props.id()
  let trigger = $state<HTMLButtonElement | null>(null)

  setPopoverState({
    id,
    get open() {
      return open
    },
    set open(next) {
      open = next
    },
    get trigger() {
      return trigger
    },
    set trigger(next) {
      trigger = next
    },
  })
</script>

{@render children?.()}
