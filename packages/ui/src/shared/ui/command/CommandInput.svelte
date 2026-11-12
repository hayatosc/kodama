<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search'
  import { Command as CommandPrimitive } from 'bits-ui'
  import { cn } from '#shared/lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(''),
    ...restProps
  }: CommandPrimitive.InputProps = $props()
</script>

<!--
  The menu's search row: a magnifier and a bare input, with a 1px line below. The input draws no
  ring of its own, so the row shows the focus ring (an inset outline, inside the scroll area, so
  it is not clipped and stays visible in forced colors mode).
-->
<div
  data-slot="command-input-wrapper"
  class="sticky top-0 z-10 -mx-1 -mt-1 mb-1 flex h-10 shrink-0 rounded-t-xl items-center gap-2 border-b border-border bg-popover px-3 text-muted-foreground has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-ring"
>
  <SearchIcon class="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
  <CommandPrimitive.Input
    bind:value
    bind:ref
    data-slot="command-input"
    class={cn(
      'h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground',
      className,
    )}
    {...restProps}
  />
</div>
