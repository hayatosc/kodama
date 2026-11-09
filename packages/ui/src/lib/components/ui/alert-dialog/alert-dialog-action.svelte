<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'
  import { buttonVariants } from '#lib/components/ui/button/variants.js'
  import { cn } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    destructive = false,
    ...restProps
  }: AlertDialogPrimitive.ActionProps & {
    /** Fills the button with `destructive`, for confirms that delete or archive. */
    destructive?: boolean
  } = $props()
</script>

<AlertDialogPrimitive.Action
  bind:ref
  data-slot="alert-dialog-action"
  class={cn(
    buttonVariants({ variant: 'primary' }),
    destructive && 'bg-destructive text-background',
    className,
  )}
  {...restProps}
/>
