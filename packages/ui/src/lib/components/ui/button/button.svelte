<script lang="ts">
  import { cn } from '#lib/utils.js'
  import { buttonVariants, type ButtonProps } from './variants.js'

  let {
    class: className,
    variant = 'primary',
    size = 'default',
    ref = $bindable(null),
    type = 'button',
    children,
    ...restProps
  }: ButtonProps = $props()
</script>

<button
  bind:this={ref}
  data-slot="button"
  class={cn(buttonVariants({ variant, size }), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
