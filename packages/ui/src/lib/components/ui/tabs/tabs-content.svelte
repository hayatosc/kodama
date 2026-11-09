<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui'
  import { cn } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: TabsPrimitive.ContentProps = $props()
</script>

<TabsPrimitive.Content
  bind:ref
  data-slot="tabs-content"
  class={cn('flex flex-col gap-2 pt-3 outline-none', className)}
  {...restProps}
/>
