<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { toggleVariants } from '../toggle/variants.js'
  import { getToggleGroupState } from './context.js'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value,
    disabled,
    class: className,
    onclick,
    children,
    ...restProps
  }: WithElementRef<
    Omit<HTMLButtonAttributes, 'type' | 'aria-pressed' | 'value'>,
    HTMLButtonElement
  > & {
    value: string
  } = $props()

  const group = getToggleGroupState()

  function press(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }): void {
    group.press(value)
    onclick?.(event)
  }
</script>

<button
  bind:this={ref}
  type="button"
  data-slot="toggle-group-item"
  aria-pressed={group.isPressed(value)}
  disabled={disabled ?? group.disabled}
  class={cn(toggleVariants({ variant: group.variant, size: group.size }), className)}
  onclick={press}
  {...restProps}
>
  {@render children?.()}
</button>
