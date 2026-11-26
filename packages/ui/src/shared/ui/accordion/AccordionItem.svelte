<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getAccordionState } from './context.js'
  import type { HTMLDetailsAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    open = $bindable(false),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLDetailsAttributes, HTMLDetailsElement> = $props()

  const accordion = getAccordionState()
</script>

<!--
  One item: a native <details>, sharing the group's name when only one may be open. The content
  slides through ::details-content, only without a reduced-motion request; where
  interpolate-size is missing it opens at once.
-->
<details
  bind:this={ref}
  bind:open
  name={accordion?.name}
  data-slot="accordion-item"
  class={cn(
    'border-b border-border details-content:overflow-clip details-content:[contain:layout] details-content:[interpolate-size:allow-keywords] not-open:details-content:[block-size:0]',
    'motion-safe:details-content:transition-[block-size,content-visibility] motion-safe:details-content:duration-200 motion-safe:details-content:ease-in-out motion-safe:details-content:transition-discrete',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</details>
