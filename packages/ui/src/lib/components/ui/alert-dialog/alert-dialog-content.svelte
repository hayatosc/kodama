<script lang="ts">
  import DialogContent from '../dialog/dialog-content.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    ...restProps
  }: Omit<
    ComponentProps<typeof DialogContent>,
    'showCloseButton' | 'closeLabel' | 'role'
  > = $props()
</script>

<!--
  The same native modal as Dialog, exposed as an alert dialog and without the × button: the
  footer's Cancel is the way out. The browser focuses the first button on open, so Cancel comes
  first in the footer and Enter right after opening never confirms (dialog guide).
-->
<DialogContent bind:ref role="alertdialog" showCloseButton={false} {...restProps} />
