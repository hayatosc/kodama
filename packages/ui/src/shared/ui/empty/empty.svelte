<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props()
</script>

<!--
  What a place shows while it has nothing yet: what will appear here, and the action that adds
  the first one. Centered, in quiet text.
-->
<div
  bind:this={ref}
  data-slot="empty"
  class={cn(
    'flex min-w-0 flex-col items-center justify-center gap-4 rounded-xl px-6 py-10 text-center text-balance',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
