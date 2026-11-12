<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { Attachment } from 'svelte/attachments'
  import type { HTMLTableAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    label,
    children,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> & {
    /**
     * Names the scroll area around the table; usually the caption's text. Keyboard users can
     * focus the area and scroll it with the arrow keys when the table is wider than its column.
     */
    label: string
  } = $props()

  /**
   * Makes the area a Tab stop only while the table overflows it, so a keyboard can scroll what a
   * pointer can, and a table that fits adds no stop that does nothing.
   */
  const focusableWhileScrolling: Attachment<HTMLDivElement> = (area) => {
    const update = (): void => {
      if (area.scrollWidth > area.clientWidth) area.tabIndex = 0
      else area.removeAttribute('tabindex')
    }
    const observer = new ResizeObserver(update)
    observer.observe(area)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    return () => observer.disconnect()
  }
</script>

<!--
  A native table in a scroll area (responsive-table guide): the area scrolls sideways when the
  table is wider than its column, the header row stays on top while it scrolls, and the area is
  a named region that takes keyboard focus while it scrolls, so it can be scrolled without a mouse.
-->
<div
  role="region"
  aria-label={label}
  data-slot="table-container"
  class="relative w-full overflow-x-auto rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
  {@attach focusableWhileScrolling}
>
  <table
    bind:this={ref}
    data-slot="table"
    class={cn('w-full border-separate border-spacing-0 text-sm', className)}
    {...restProps}
  >
    {@render children?.()}
  </table>
</div>
