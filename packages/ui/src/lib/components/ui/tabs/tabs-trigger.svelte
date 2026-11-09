<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui'
  import { cn, focusRing } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: TabsPrimitive.TriggerProps = $props()
</script>

<!-- design/components/Tabs: the selected tab sits on muted; the others are muted text. -->
<TabsPrimitive.Trigger
  bind:ref
  data-slot="tabs-trigger"
  class={cn(
    'inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-sm font-semibold whitespace-nowrap',
    'text-muted-foreground transition-colors duration-[120ms] hover:text-foreground',
    'data-[state=active]:bg-muted data-[state=active]:text-foreground',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
    focusRing,
    className,
  )}
  {...restProps}
/>
