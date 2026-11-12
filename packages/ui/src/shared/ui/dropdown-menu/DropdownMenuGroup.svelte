<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    label,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** The group's visible name, such as アカウント. */
    label: string
  } = $props()

  const id = $props.id()
</script>

<!-- Related items under a visible heading that also names the group. -->
<div
  bind:this={ref}
  role="group"
  aria-labelledby={`${id}-label`}
  data-slot="dropdown-menu-group"
  class={cn('flex flex-col', className)}
  {...restProps}
>
  <div id={`${id}-label`} class="px-2 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
    {label}
  </div>
  {@render children?.()}
</div>
