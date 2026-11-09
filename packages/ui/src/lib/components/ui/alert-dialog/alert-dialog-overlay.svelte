<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'
  import { cn } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AlertDialogPrimitive.OverlayProps = $props()
</script>

<!-- A 32% black scrim (design/components/Dialog). -->
<AlertDialogPrimitive.Overlay
  bind:ref
  data-slot="alert-dialog-overlay"
  class={cn(
    'fixed inset-0 z-50 bg-black/32 data-[state=open]:animate-in data-[state=open]:fade-in-0',
    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none',
    className,
  )}
  {...restProps}
/>
