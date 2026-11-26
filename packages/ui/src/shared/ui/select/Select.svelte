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

  /**
   * The customizable select's trigger icon and options (branded-select-styling,
   * animated-select-picker): the design's chevron-down instead of the browser's arrow, turned up
   * while open; 36px options with a 12px menu radius minus its 4px padding, so the corners nest.
   * The current value is marked three ways: a check, a background, and a heavier weight.
   */
  const customizable = [
    'base-select:[appearance:base-select]',
    "base-select:[&::picker-icon]:size-4 base-select:[&::picker-icon]:bg-muted-foreground base-select:[&::picker-icon]:mask-chevron-down base-select:[&::picker-icon]:content-[''] base-select:[&::picker-icon]:[transition:rotate_150ms_ease-out] base-select:open:[&::picker-icon]:rotate-180 forced-colors:base-select:[&::picker-icon]:bg-[CanvasText] motion-reduce:[&::picker-icon]:[transition:none]",
    'base-select:[&_option]:flex base-select:[&_option]:min-h-9 base-select:[&_option]:cursor-pointer base-select:[&_option]:items-center base-select:[&_option]:gap-2 base-select:[&_option]:rounded-lg base-select:[&_option]:px-2 base-select:[&_option]:py-1.5 base-select:[&_option]:text-[14px] base-select:[&_option]:leading-5 base-select:[&_option]:text-foreground',
    'base-select:[&_option:is(:hover,:focus-visible,:checked)]:bg-accent base-select:[&_option:checked]:font-semibold base-select:[&_option:focus-visible]:outline-2 base-select:[&_option:focus-visible]:-outline-offset-2 base-select:[&_option:focus-visible]:outline-ring base-select:[&_option:disabled]:cursor-not-allowed base-select:[&_option:disabled]:text-muted-foreground',
    'base-select:[&_option::checkmark]:order-1 base-select:[&_option::checkmark]:ms-auto',
    'base-select:[&_optgroup]:pt-1.5 base-select:[&_optgroup]:text-[12px] base-select:[&_optgroup]:leading-4 base-select:[&_optgroup]:font-normal base-select:[&_optgroup]:text-muted-foreground base-select:[&_optgroup>option]:mt-1',
    'base-select:[&_hr]:-mx-1 base-select:[&_hr]:my-1 base-select:[&_hr]:border-x-0 base-select:[&_hr]:border-t base-select:[&_hr]:border-b-0 base-select:[&_hr]:border-border',
  ]

  /**
   * The menu surface of design/components/Select, faded in from @starting-style. It opens below
   * the trigger and flips only when it would not fit; the browser's default opens toward whichever
   * side has more room, which puts it above a trigger in the lower half for no reason.
   */
  const picker =
    '[&::picker(select)]:my-1 [&::picker(select)]:max-h-[260px] [&::picker(select)]:rounded-xl [&::picker(select)]:border [&::picker(select)]:border-border [&::picker(select)]:bg-popover [&::picker(select)]:p-1 [&::picker(select)]:text-foreground [&::picker(select)]:opacity-0 [&::picker(select)]:shadow-lg [&::picker(select)]:transition-[opacity,display,overlay] [&::picker(select)]:duration-150 [&::picker(select)]:ease-out [&::picker(select)]:transition-discrete [&::picker(select)]:[appearance:base-select] [&::picker(select)]:[min-inline-size:anchor-size(width)] [&::picker(select)]:[position-try-order:normal] open:[&::picker(select)]:opacity-100 starting:open:[&::picker(select)]:opacity-0'
</script>

<!--
  A native <select>, opted into the customizable select where the browser has it
  (branded-select-styling): the browser handles the keyboard, the top layer, and form
  submission. Elsewhere it opens the system menu with the same trigger. Give it a <label>.
  design/components/Select: the trigger is 36px with a 1px input border. Below 768px the text is
  16px, so iOS does not zoom on focus, and touch screens get a 48px trigger (forms guide).
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
    customizable,
    picker,
    focusRing,
    className,
  )}
  {@attach controlled ? undefined : syncUserInvalid}
  {...restProps}
>
  {@render children?.()}
</select>
