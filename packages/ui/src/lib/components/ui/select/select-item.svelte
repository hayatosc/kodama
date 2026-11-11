<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLOptionAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLOptionAttributes, HTMLOptionElement> = $props()
</script>

<!-- An <option>. Keep its text meaningful alone: the system menu shows only the text. -->
<option bind:this={ref} data-slot="select-item" class={cn(className)} {...restProps}>
  {@render children?.()}
</option>
