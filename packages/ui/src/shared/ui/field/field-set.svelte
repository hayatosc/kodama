<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLFieldsetAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLFieldsetAttributes, HTMLFieldSetElement> = $props()
</script>

<!-- A native fieldset for related controls; its first child is a Field.Legend (forms guide). -->
<fieldset
  bind:this={ref}
  data-slot="field-set"
  class={cn('flex min-w-0 flex-col gap-4', className)}
  {...restProps}
>
  {@render children?.()}
</fieldset>
