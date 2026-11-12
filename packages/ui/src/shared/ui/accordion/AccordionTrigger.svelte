<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!--
  The native <summary>, which screen readers expose as a button. Do not put a heading inside it:
  some screen readers drop headings in a summary. The chevron sits right before the label.
-->
<summary
  bind:this={ref}
  data-slot="accordion-trigger"
  class={cn(
    'min-h-11 rounded-md py-2 text-sm font-semibold text-foreground transition-colors duration-[120ms] hover:text-foreground/80',
    focusRing,
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</summary>
