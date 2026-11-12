<script lang="ts">
  import { setDropdownMenuState } from './context.js'
  import type { Snippet } from 'svelte'

  let {
    open = $bindable(false),
    children,
  }: {
    /** Whether the menu is open. */
    open?: boolean
    children?: Snippet
  } = $props()

  const id = $props.id()
  let trigger = $state<HTMLButtonElement | null>(null)
  let content = $state<HTMLDivElement | null>(null)
  let enterOnOpen = false

  setDropdownMenuState({
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
    get content() {
      return content
    },
    set content(next) {
      content = next
    },
    get enterOnOpen() {
      return enterOnOpen
    },
    set enterOnOpen(next) {
      enterOnOpen = next
    },
  })
</script>

{@render children?.()}
