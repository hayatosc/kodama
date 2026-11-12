<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import { syncUserInvalid } from '#shared/lib/user-invalid.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    ...restProps
  }: WithElementRef<Omit<HTMLInputAttributes, 'type'>, HTMLInputElement> & {
    /** Any text-like type; use Checkbox, RadioGroup, and Slider for the others. */
    type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'number' | 'date' | 'time'
  } = $props()

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': invalid,
    }),
  )
  /** Whether the caller or the field sets the invalid state; otherwise :user-invalid drives it. */
  const controlled = $derived(attributes['aria-invalid'] !== undefined)
</script>

<!--
  A native text input (forms guide). 16px text, so iOS does not zoom on focus; 36px high, 48px on
  touch screens. The border turns destructive once the value is invalid after the user has
  interacted (:user-invalid), or when aria-invalid is set.
-->
<input
  bind:this={ref}
  bind:value
  data-slot="input"
  {...attributes}
  class={cn(
    'flex h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground pointer-coarse:h-12',
    'placeholder:text-muted-foreground',
    'file:-ms-1 file:me-3 file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground',
    'user-invalid:border-destructive aria-invalid:border-destructive',
    'disabled:cursor-not-allowed disabled:opacity-40',
    focusRing,
    className,
  )}
  {@attach controlled ? undefined : syncUserInvalid}
  {...restProps}
/>
