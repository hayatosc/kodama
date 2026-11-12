<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    class: className,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    ...restProps
  }: WithElementRef<Omit<HTMLInputAttributes, 'type' | 'role'>, HTMLInputElement> = $props()

  /**
   * The native switch attribute, which Svelte's attribute types do not list yet. Where it is
   * missing, `role="switch"` gives the same semantics and the styles below give the same look.
   */
  const nativeSwitch = { switch: true }

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': invalid,
    }),
  )
</script>

<!--
  design/components/Switch: 34×20, inverted when on, the 16px knob moves in 150ms.
  A native checkbox (switch guide): it submits with forms and toggles with Space. The input is the
  track, and the knob is a sibling span, since inputs cannot hold pseudo-elements everywhere.
  In forced colors mode, the transparent borders turn into outlines, so the track and the knob's
  position still show.
-->
<span data-slot="switch" class={cn('relative inline-flex h-5 w-[34px] shrink-0', className)}>
  <input
    bind:this={ref}
    bind:checked
    type="checkbox"
    role="switch"
    {...attributes}
    class={cn(
      'peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full border border-transparent',
      'bg-input transition-colors duration-150 checked:bg-primary',
      'disabled:cursor-not-allowed disabled:opacity-40',
      focusRing,
    )}
    {...nativeSwitch}
    {...restProps}
  />
  <span
    aria-hidden="true"
    class={cn(
      'pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full border border-transparent bg-background shadow-sm',
      'peer-checked:translate-x-3.5 peer-checked:bg-primary-foreground peer-disabled:opacity-40',
      'motion-safe:transition-[translate,background-color] motion-safe:duration-150',
    )}
  ></span>
</span>
