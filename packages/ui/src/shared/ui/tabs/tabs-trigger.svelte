<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui'
  import { cn, focusRing } from '#shared/lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: TabsPrimitive.TriggerProps = $props()
</script>

<!--
  design/components/Tabs: the selected tab sits on muted; the others are muted text.
  Color alone may not mark the selected tab (tabs guide, WCAG 1.4.1), and forced colors mode
  removes backgrounds, so the selected tab also gets a border, drawn on a pseudo-element so the
  tab keeps its size.
-->
<TabsPrimitive.Trigger
  bind:ref
  data-slot="tabs-trigger"
  class={cn(
    'relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-semibold whitespace-nowrap',
    'text-muted-foreground transition-colors duration-[120ms] hover:text-foreground',
    'data-[state=active]:bg-muted data-[state=active]:text-foreground',
    "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:content-['']",
    'data-[state=active]:after:border data-[state=active]:after:border-input',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
    focusRing,
    className,
  )}
  {...restProps}
/>
