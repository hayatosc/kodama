<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { toggleVariants, type ToggleSize, type ToggleVariant } from './variants.js'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    pressed = $bindable(false),
    variant = 'plain',
    size = 'default',
    class: className,
    onclick,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLButtonAttributes, 'type' | 'aria-pressed'>, HTMLButtonElement> & {
    pressed?: boolean
    variant?: ToggleVariant
    size?: ToggleSize
  } = $props()

  function toggle(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }): void {
    pressed = !pressed
    onclick?.(event)
  }
</script>

<!--
  A native button with aria-pressed, for a setting that stays on or off, such as bold. Its label
  never changes with the state; an action that runs once is a Button.
-->
<button
  bind:this={ref}
  type="button"
  data-slot="toggle"
  aria-pressed={pressed}
  class={cn(toggleVariants({ variant, size }), className)}
  onclick={toggle}
  {...restProps}
>
  {@render children?.()}
</button>
