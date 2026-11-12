<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import { syncUserInvalid } from '#shared/lib/user-invalid.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLSelectAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(),
    size = 'default',
    class: className,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLSelectAttributes, 'size' | 'multiple'>, HTMLSelectElement> & {
    /** `default` for forms; `sm` is the 28px trigger at the right edge of a settings row. */
    size?: 'default' | 'sm'
  } = $props()

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': invalid,
    }),
  )
  const controlled = $derived(attributes['aria-invalid'] !== undefined)
</script>

<!--
  A native <select>, opted into the customizable select where the browser has it
  (branded-select-styling): the browser handles the keyboard, the top layer, and form
  submission. Elsewhere it opens the system menu with the same trigger. Give it a <label>.
  design/components/Select: the trigger is 36px with a 1px input border; the menu's styles are in
  src/shared/styles/native.css. Below 768px the text is 16px, so iOS does not zoom on focus, and
  touch screens get a 48px trigger (forms guide).
-->
<select
  bind:this={ref}
  bind:value
  data-slot="select"
  data-size={size}
  {...attributes}
  class={cn(
    'inline-flex cursor-pointer items-center justify-between gap-2 bg-background text-base text-foreground md:text-sm',
    'user-invalid:border-destructive aria-invalid:border-destructive',
    'disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-12',
    size === 'default'
      ? 'h-9 min-w-[220px] rounded-lg border border-input px-2.5'
      : 'h-7 rounded-md border border-input px-2 hover:bg-accent',
    focusRing,
    className,
  )}
  {@attach controlled ? undefined : syncUserInvalid}
  {...restProps}
>
  {@render children?.()}
</select>
