<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui'
  import { cn } from '#shared/lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    children: childContent,
    ...restProps
  }: CommandPrimitive.ListProps = $props()
</script>

<!--
  The Viewport gives the search field's aria-controls an element to point at. The list does not
  scroll on its own: the whole Command does (see Command.svelte).
-->
<CommandPrimitive.List
  bind:ref
  data-slot="command-list"
  class={cn('outline-none', className)}
  {...restProps}
>
  <CommandPrimitive.Viewport>
    {@render childContent?.()}
  </CommandPrimitive.Viewport>
</CommandPrimitive.List>
