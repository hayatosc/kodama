<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    orientation = 'horizontal',
    decorative = true,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    orientation?: 'horizontal' | 'vertical'
    /**
     * A purely visual line, hidden from assistive technology (the default). Set it to false for a
     * line that separates sections, which is then exposed as a separator.
     */
    decorative?: boolean
  } = $props()
</script>

<!-- A 1px line in the border color. A semantic horizontal one is a native <hr>. -->
{#if !decorative && orientation === 'horizontal'}
  <hr
    bind:this={ref}
    data-slot="separator"
    class={cn('h-px w-full shrink-0 border-0 bg-border', className)}
    {...restProps}
  />
{:else}
  <div
    bind:this={ref}
    data-slot="separator"
    data-orientation={orientation}
    role={decorative ? 'none' : 'separator'}
    aria-orientation={decorative ? undefined : orientation}
    class={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
      className,
    )}
    {...restProps}
  ></div>
{/if}
