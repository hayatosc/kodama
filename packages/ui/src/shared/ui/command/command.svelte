<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui'
  import { cn } from '#shared/lib/utils.js'

  let {
    ref = $bindable(null),
    value = $bindable(''),
    class: className,
    ...restProps
  }: CommandPrimitive.RootProps = $props()
</script>

<!--
  The search field and the list scroll together, with the field pinned on top, so the scroll
  region always holds a focusable element (WCAG 2.1.1) and focus never leaves the field.
  scroll-padding keeps the highlighted item from sliding under the field.
-->
<CommandPrimitive.Root
  bind:value
  bind:ref
  data-slot="command"
  class={cn(
    'flex max-h-[300px] scroll-pt-[42px] flex-col overflow-y-auto p-1 text-foreground',
    className,
  )}
  {...restProps}
/>
