<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!-- The title and its description; an action, such as a menu button, can sit at the end. -->
<header
  bind:this={ref}
  data-slot="card-header"
  class={cn(
    'grid gap-1 has-[[data-slot=card-action]]:grid-cols-[1fr_auto]',
    '[&>[data-slot=card-action]]:col-start-2 [&>[data-slot=card-action]]:row-span-2 [&>[data-slot=card-action]]:row-start-1 [&>[data-slot=card-action]]:self-start',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</header>
