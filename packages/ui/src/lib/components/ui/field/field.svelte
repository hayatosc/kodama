<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { setFieldState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    orientation = 'vertical',
    invalid = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** `vertical` stacks the label above the control; `horizontal` puts a checkbox or switch first. */
    orientation?: 'vertical' | 'horizontal'
    /** Marks the control invalid, for errors found outside the browser's own validation. */
    invalid?: boolean
  } = $props()

  const id = $props.id()
  let described = $state(false)
  let erred = $state(false)

  setFieldState({
    id,
    get invalid() {
      return invalid
    },
    get described() {
      return described
    },
    set described(next) {
      described = next
    },
    get erred() {
      return erred
    },
    set erred(next) {
      erred = next
    },
  })
</script>

<!--
  One control with its label, description, and error. The label sits right above the control,
  closer than fields sit to each other (forms guide, proximity). In a horizontal field the
  label's hit area covers the whole 44px row, so a click anywhere in it toggles the control
  (checkbox guide); the control itself sits above that area and takes its own clicks.
-->
<div
  bind:this={ref}
  data-slot="field"
  data-orientation={orientation}
  data-invalid={invalid || undefined}
  class={cn(
    'flex gap-1.5',
    orientation === 'vertical'
      ? 'flex-col'
      : [
          'relative min-h-11 flex-row items-center gap-3 [&>[data-slot=field-content]]:flex-1',
          "[&_[data-slot=field-label]]:cursor-pointer [&_[data-slot=field-label]]:after:absolute [&_[data-slot=field-label]]:after:inset-0 [&_[data-slot=field-label]]:after:content-['']",
          '[&>input]:relative [&>input]:z-[1] [&>[data-slot=switch]]:z-[1]',
        ],
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
