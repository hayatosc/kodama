<script lang="ts">
  import { Button, type ButtonProps } from '#shared/ui/button/index.js'
  import { cn } from '#shared/lib/utils.js'
  import { getDialogState } from '../dialog/context.js'

  let {
    ref = $bindable(null),
    variant = 'primary',
    onclick,
    class: className,
    ...restProps
  }: Omit<ButtonProps, 'variant'> & {
    /** `destructive` fills the button with the destructive color, for actions that delete. */
    variant?: 'primary' | 'destructive'
  } = $props()

  const dialog = getDialogState()

  /** Runs the action, then closes the dialog unless the handler called preventDefault(). */
  function act(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }): void {
    onclick?.(event)
    if (!event.defaultPrevented) dialog.open = false
  }
</script>

<!-- design/components/Dialog: a destructive confirm is filled (black text in dark). -->
<Button
  bind:ref
  data-slot="alert-dialog-action"
  variant="primary"
  class={cn(variant === 'destructive' && 'bg-destructive text-background', className)}
  onclick={act}
  {...restProps}
/>
