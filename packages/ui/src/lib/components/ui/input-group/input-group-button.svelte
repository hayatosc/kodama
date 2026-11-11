<script lang="ts">
  import { Button, type ButtonProps } from '#lib/components/ui/button/index.js'
  import { cn } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    variant = 'ghost',
    size = 'icon-sm',
    class: className,
    ...restProps
  }: ButtonProps = $props()
</script>

<!-- A button inside the group, such as clear or send; an icon-only one needs an aria-label. -->
<Button
  bind:ref
  data-slot="input-group-button"
  {variant}
  {size}
  class={cn('size-7 rounded-md', className)}
  {...restProps}
/>
