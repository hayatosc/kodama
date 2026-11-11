<script lang="ts">
  import { Button, type ButtonProps } from '#lib/components/ui/button/index.js'
  import { wireHint } from '#lib/hint.js'
  import { loadInterestForPolyfill } from '#lib/polyfills.js'
  import { getTooltipState } from './context.js'
  import type { Attachment } from 'svelte/attachments'

  let { ref = $bindable(null), variant = 'secondary', ...restProps }: ButtonProps = $props()

  const tooltip = getTooltipState()

  /**
   * Registers the trigger, relates the hint to it for assistive technology, and only then loads
   * the interestfor polyfill where interest invokers are missing (the guide's order: the
   * attributes must be in place before any interaction).
   */
  const register: Attachment<HTMLButtonElement> = (element) => {
    tooltip.trigger = element
    const hint = document.getElementById(tooltip.id)
    if (hint) wireHint(element, hint)
    loadInterestForPolyfill().catch(() => undefined)
    return () => {
      tooltip.trigger = null
    }
  }
</script>

<!--
  interestfor shows the hint on hover, keyboard focus, and long press, and the trigger becomes the
  hint's implicit anchor. The trigger keeps its own action; the hint only adds to it.
-->
<Button
  bind:ref
  data-slot="tooltip-trigger"
  {variant}
  interestfor={tooltip.id}
  {@attach register}
  {...restProps}
/>
