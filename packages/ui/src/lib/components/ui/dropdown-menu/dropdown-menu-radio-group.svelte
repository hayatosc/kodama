<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { setDropdownMenuRadioState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(''),
    label,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** The checked item's value. */
    value?: string
    /** The group's visible name, such as 並び順. */
    label: string
  } = $props()

  const id = $props.id()

  setDropdownMenuRadioState({
    get value() {
      return value
    },
    set value(next) {
      value = next
    },
  })
</script>

<!-- One of a set: menuitemradio items in a group named by its visible label, in the same focusgroup. -->
<div
  bind:this={ref}
  role="group"
  aria-labelledby={`${id}-label`}
  data-slot="dropdown-menu-radio-group"
  class={cn('flex flex-col', className)}
  {...restProps}
>
  <div id={`${id}-label`} class="px-2 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
    {label}
  </div>
  {@render children?.()}
</div>
