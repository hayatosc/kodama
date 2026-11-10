<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#lib/utils.js'

  let {
    composer,
    children,
    mobile = false,
    class: className,
  }: {
    /** The Composer, floating at the bottom over the conversation. */
    composer: Snippet
    /** The transcript, oldest first. */
    children: Snippet
    /** Phones: narrower margins and the home indicator's inset below the composer. */
    mobile?: boolean
    class?: string
  } = $props()
</script>

<div class={cn('relative h-full min-h-0', className)}>
  <div class="h-full overflow-y-auto">
    <div
      class={cn(
        'mx-auto flex w-full max-w-[960px] flex-col',
        mobile ? 'px-4 pt-4 pb-48' : 'px-8 pt-16 pb-56',
      )}
    >
      <!-- Gives the transcript a place in the heading outline, between the agent and its replies. -->
      <h2 class="sr-only">会話</h2>
      {@render children()}
    </div>
  </div>
  <!-- The conversation scrolls beneath the composer; a fade keeps the last lines readable. -->
  <div
    class={cn(
      'pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-background from-60% to-transparent pt-8',
      mobile ? 'px-3 pb-[max(12px,env(safe-area-inset-bottom))]' : 'px-8 pb-4',
    )}
  >
    <div class="pointer-events-auto">{@render composer()}</div>
  </div>
</div>
