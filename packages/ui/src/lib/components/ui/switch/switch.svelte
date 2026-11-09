<script lang="ts">
  import { Switch as SwitchPrimitive } from 'bits-ui'
  import { cn, focusRing, type WithoutChildrenOrChild } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    checked = $bindable(false),
    ...restProps
  }: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props()
</script>

<!-- design/components/Switch: 34×20, inverted when on, the 16px knob moves in 150ms. -->
<SwitchPrimitive.Root
  bind:ref
  bind:checked
  data-slot="switch"
  class={cn(
    'peer inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full p-0 transition-colors duration-150',
    'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
    'data-[disabled]:cursor-default data-[disabled]:opacity-40',
    focusRing,
    className,
  )}
  {...restProps}
>
  <SwitchPrimitive.Thumb
    data-slot="switch-thumb"
    class={cn(
      'pointer-events-none block size-4 rounded-full shadow-sm transition-transform duration-150',
      'translate-x-0.5 bg-background data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground',
    )}
  />
</SwitchPrimitive.Root>
