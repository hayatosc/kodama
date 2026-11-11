<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#lib/utils.js'
  import type { HTMLSelectAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(),
    size = 'default',
    class: className,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLSelectAttributes, 'size' | 'multiple'>, HTMLSelectElement> & {
    /** `default` for forms; `sm` is the 28px trigger at the right edge of a settings row. */
    size?: 'default' | 'sm'
  } = $props()
</script>

<!--
  A native <select>, opted into the customizable select where the browser has it
  (branded-select-styling): the browser handles the keyboard, the top layer, and form
  submission. Elsewhere it opens the system menu with the same trigger. Give it a <label>.
  design/components/Select: the trigger is 36px with a 1px input border; the menu's styles are in
  src/lib/styles/native.css.
-->
<select
  bind:this={ref}
  bind:value
  data-slot="select"
  data-size={size}
  class={cn(
    'inline-flex cursor-pointer items-center justify-between gap-2 bg-background text-sm text-foreground',
    'aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-40',
    size === 'default'
      ? 'h-9 min-w-[220px] rounded-lg border border-input px-2.5'
      : 'h-7 rounded-md border border-input px-2 hover:bg-accent',
    focusRing,
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</select>
