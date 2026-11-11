<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, 'children'>> = $props()
</script>

<!--
  A placeholder shape where content will load. It is hidden from assistive technology: announce
  the loading once in words instead (role="status"). It pulses only without a reduced-motion
  request.
-->
<div
  bind:this={ref}
  data-slot="skeleton"
  aria-hidden="true"
  class={cn('rounded-md bg-muted motion-safe:animate-pulse', className)}
  {...restProps}
></div>
