<script lang="ts">
  import { Button, type ButtonProps } from '#lib/components/ui/button/index.js'
  import { getPopoverState } from './context.js'
  import type { Attachment } from 'svelte/attachments'

  let { ref = $bindable(null), variant = 'secondary', ...restProps }: ButtonProps = $props()

  const popover = getPopoverState()

  const register: Attachment<HTMLButtonElement> = (element) => {
    popover.trigger = element
    return () => {
      popover.trigger = null
    }
  }
</script>

<!--
  popovertarget opens and closes the popover natively, and the browser sets aria-expanded on the
  button (declarative-dialog-popover-control). The anchor name tethers Content to the button.
-->
<Button
  bind:ref
  data-slot="popover-trigger"
  {variant}
  popovertarget={popover.id}
  style={`anchor-name: --${popover.id}`}
  {@attach register}
  {...restProps}
/>
