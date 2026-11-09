<script lang="ts">
  import { Popover as PopoverPrimitive } from 'bits-ui'
  import { cn, type WithoutChildrenOrChild } from '#lib/utils.js'
  import PopoverPortal from './popover-portal.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 4,
    align = 'start',
    portalProps,
    ...restProps
  }: PopoverPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>
  } = $props()
</script>

<!-- The menu surface of design/components/Select: popover, 1px border, rounded-xl, shadow-lg. -->
<PopoverPortal {...portalProps}>
  <PopoverPrimitive.Content
    bind:ref
    data-slot="popover-content"
    {sideOffset}
    {align}
    class={cn(
      'z-50 min-w-[220px] rounded-xl border border-border bg-popover p-1 text-foreground shadow-lg outline-none',
      'origin-(--bits-popover-content-transform-origin)',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      'motion-reduce:animate-none',
      className,
    )}
    {...restProps}
  />
</PopoverPortal>
