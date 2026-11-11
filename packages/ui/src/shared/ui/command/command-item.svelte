<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check'
  import { Command as CommandPrimitive } from 'bits-ui'
  import { cn } from '#shared/lib/utils.js'

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

<!--
  min-h-9, rounded-lg (the list's 12px radius minus its 4px padding); the highlighted item and the hover use accent. The current value is marked
  by a check and a heavier weight, and named for screen readers, since aria-selected here follows
  the highlight rather than the value.
-->
<CommandPrimitive.Item
  bind:ref
  data-slot="command-item"
  class={cn(
    'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none',
    'hover:bg-accent data-[selected]:bg-accent',
    'data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground',
    className,
  )}
  {...restProps}
>
  <span class={cn('min-w-0 flex-1', checked && 'font-semibold')}>{@render children?.()}</span>
  {#if checked}
    <span class="sr-only">（選択中）</span>
    <CheckIcon class="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
  {/if}
</CommandPrimitive.Item>
