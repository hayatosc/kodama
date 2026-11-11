<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { setToggleGroupState } from './context.js'
  import type { ToggleSize, ToggleVariant } from '../toggle/variants.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    type = 'single',
    value = $bindable(type === 'single' ? '' : []),
    variant = 'plain',
    size = 'default',
    disabled = false,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /**
     * `single`: exactly one item is pressed, like alignment; pressing it again keeps it pressed.
     * `multiple`: any number, like bold and italic.
     */
    type?: 'single' | 'multiple'
    /** The pressed value (`single`) or values (`multiple`). */
    value?: string | string[]
    variant?: ToggleVariant
    size?: ToggleSize
    disabled?: boolean
  } = $props()

  setToggleGroupState({
    isPressed: (item) => (Array.isArray(value) ? value.includes(item) : value === item),
    press: (item) => {
      if (type === 'single') {
        value = item
        return
      }
      const pressed = Array.isArray(value) ? value : []
      value = pressed.includes(item) ? pressed.filter((v) => v !== item) : [...pressed, item]
    },
    get variant() {
      return variant
    },
    get size() {
      return size
    },
    get disabled() {
      return disabled
    },
  })
</script>

<!--
  Toggle buttons that belong together, named as a group (role="group" with an aria-label). Each
  item announces its own pressed state; every item stays a Tab stop.
-->
<div
  bind:this={ref}
  role="group"
  data-slot="toggle-group"
  class={cn('flex w-fit items-center gap-1', className)}
  {...restProps}
>
  {@render children?.()}
</div>
