<script lang="ts">
  import { Button, type ButtonProps } from '#shared/ui/button/index.js'
  import { wireHint } from '#shared/lib/hint.js'
  import { loadInterestForPolyfill } from '#shared/lib/polyfills.js'
  import { cn } from '#shared/lib/utils.js'
  import { getTooltipState } from './context.js'
  import type { Attachment } from 'svelte/attachments'

  let {
    ref = $bindable(null),
    variant = 'secondary',
    class: className,
    ...restProps
  }: ButtonProps = $props()

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
  hint's implicit anchor. The trigger keeps its own action; the hint only adds to it. The interest
  delays keep a pointer passing over the trigger from flashing the hint; the custom properties are
  what the polyfill reads.
-->
<Button
  bind:ref
  data-slot="tooltip-trigger"
  {variant}
  interestfor={tooltip.id}
  class={cn(
    '[--interest-delay-end:0.2s] [--interest-delay-start:0.4s] [interest-delay-end:var(--interest-delay-end)] [interest-delay-start:var(--interest-delay-start)]',
    className,
  )}
  {@attach register}
  {...restProps}
/>
