<script lang="ts">
  import { Button, type ButtonProps } from '#lib/components/ui/button/index.js'
  import { getDialogState } from './context.js'

  let { ref = $bindable(null), variant = 'secondary', ...restProps }: ButtonProps = $props()

  const dialog = getDialogState()
</script>

<!-- Opens the dialog as a modal with an invoker command, without a script of its own. -->
<Button
  bind:ref
  data-slot="dialog-trigger"
  {variant}
  command="show-modal"
  commandfor={dialog.id}
  {...restProps}
/>
