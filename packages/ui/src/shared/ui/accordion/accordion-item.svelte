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

<!-- One item: a native <details>, sharing the group's name when only one may be open. -->
<details
  bind:this={ref}
  bind:open
  name={accordion?.name}
  data-slot="accordion-item"
  class={cn('border-b border-border', className)}
  {...restProps}
>
  {@render children?.()}
</details>
