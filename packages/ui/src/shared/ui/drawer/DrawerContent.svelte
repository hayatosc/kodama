<script lang="ts">
  import { cn } from '#shared/lib/utils.js'
  import DialogContent from '../dialog/DialogContent.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    side = 'right',
    class: className,
    ...restProps
  }: ComponentProps<typeof DialogContent> & {
    /** The edge the drawer slides in from. */
    side?: 'right' | 'left' | 'bottom'
  } = $props()
</script>

<!--
  The same native modal as Dialog, pinned to an edge of the viewport: the browser still makes
  the page inert, traps and returns focus, and closes it on Esc and the backdrop. It slides in
  from its side and back out only without a reduced-motion request; otherwise it fades like any
  dialog. The scale of a centered dialog does not apply.
-->
<DialogContent
  bind:ref
  data-side={side}
  class={cn(
    'max-w-none rounded-none border-border [&>[data-slot=dialog-footer]]:mt-auto',
    'motion-safe:scale-100 motion-safe:starting:open:not-data-closing:scale-100 motion-safe:transition-[opacity,translate,display,overlay] motion-safe:duration-200 motion-safe:open:not-data-closing:translate-0',
    side === 'right' &&
      'motion-safe:translate-x-full motion-safe:starting:open:not-data-closing:translate-x-full',
    side === 'left' &&
      'motion-safe:-translate-x-full motion-safe:starting:open:not-data-closing:-translate-x-full',
    side === 'bottom' &&
      'motion-safe:translate-y-full motion-safe:starting:open:not-data-closing:translate-y-full',
    side === 'right' &&
      'ms-auto me-0 my-0 h-full max-h-full w-[min(400px,100%-3rem)] border-0 border-s',
    side === 'left' &&
      'ms-0 me-auto my-0 h-full max-h-full w-[min(400px,100%-3rem)] border-0 border-e',
    side === 'bottom' &&
      'mx-0 mt-auto mb-0 max-h-[calc(100%-3rem)] w-full rounded-t-xl border-0 border-t pb-[max(24px,env(safe-area-inset-bottom))]',
    className,
  )}
  {...restProps}
/>
