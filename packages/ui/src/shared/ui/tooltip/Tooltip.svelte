<script lang="ts">
  import { setTooltipState } from './context.js'
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet } = $props()

  const id = $props.id()
  let trigger = $state<HTMLElement | null>(null)

  setTooltipState({
    id,
    get trigger() {
      return trigger
    },
    set trigger(next) {
      trigger = next
    },
  })
</script>

{@render children?.()}
