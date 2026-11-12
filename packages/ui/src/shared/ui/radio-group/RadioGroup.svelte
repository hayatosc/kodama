<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { setRadioGroupState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(),
    name,
    disabled = false,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    value?: string
    /** The name the chosen value submits under; one is made when it is omitted. */
    name?: string
    disabled?: boolean
  } = $props()

  const id = $props.id()

  setRadioGroupState({
    get name() {
      return name ?? `radio-${id}`
    },
    get value() {
      return value
    },
    set value(next) {
      value = next
    },
    get disabled() {
      return disabled
    },
  })
</script>

<!--
  Native radios that share a name, so the browser moves between them with the arrow keys and
  submits the chosen one (forms guide: 2–5 exclusive choices). Name the group with
  aria-labelledby, or put it in a Field.Set with a Field.Legend.
-->
<div
  bind:this={ref}
  role="radiogroup"
  data-slot="radio-group"
  class={cn('flex flex-col', className)}
  {...restProps}
>
  {@render children?.()}
</div>
