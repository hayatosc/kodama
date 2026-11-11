<script lang="ts">
  import { Button, type ButtonProps } from '#lib/components/ui/button/index.js'
  import { getDialogState } from './context.js'

  let { ref = $bindable(null), variant = 'secondary', ...restProps }: ButtonProps = $props()

  const dialog = getDialogState()
</script>

<!-- Closes the dialog with an invoker command; Content plays the exit transition. -->
<Button
  bind:ref
  data-slot="dialog-close"
  {variant}
  command="close"
  commandfor={dialog.id}
  {...restProps}
/>
