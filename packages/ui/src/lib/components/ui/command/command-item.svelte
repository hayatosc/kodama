<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check'
  import { Command as CommandPrimitive } from 'bits-ui'
  import { cn } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    checked = false,
    children,
    ...restProps
  }: CommandPrimitive.ItemProps & {
    /** Marks the current value with a check at the right. */
    checked?: boolean
  } = $props()
</script>

<!-- min-h-9, rounded-md; the highlighted item and the hover use accent. -->
<CommandPrimitive.Item
  bind:ref
  data-slot="command-item"
  class={cn(
    'flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
    'hover:bg-accent data-[selected]:bg-accent',
    'data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
    className,
  )}
  {...restProps}
>
  <span class="min-w-0 flex-1">{@render children?.()}</span>
  {#if checked}
    <CheckIcon class="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
  {/if}
</CommandPrimitive.Item>
