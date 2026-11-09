<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'
  import { cn, type WithoutChild, type WithoutChildrenOrChild } from '#lib/utils.js'
  import AlertDialogOverlay from './alert-dialog-overlay.svelte'
  import AlertDialogPortal from './alert-dialog-portal.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>
  } = $props()
</script>

<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay />
  <!-- 400px wide, 24px padding, a floating surface with the large shadow. -->
  <AlertDialogPrimitive.Content
    bind:ref
    data-slot="alert-dialog-content"
    class={cn(
      'fixed top-1/2 left-1/2 z-50 w-[400px] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2',
      'rounded-xl border border-border bg-popover p-6 text-foreground shadow-lg outline-none',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      'motion-reduce:animate-none',
      className,
    )}
    {...restProps}
  />
</AlertDialogPortal>
