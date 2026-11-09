<script lang="ts">
  import { cn } from '#lib/utils.js'

  let { count, class: className }: { count: number; class?: string } = $props()

  /** Above 99 the badge shows 99+ so it keeps its width. */
  const text = $derived(count > 99 ? '99+' : String(count))
</script>

<!-- The unread count at the right edge of a sidebar row; nothing at all when it is 0. -->
{#if count > 0}
  <span
    aria-label={`未読 ${count} 件`}
    class={cn(
      'inline-block h-[18px] min-w-[18px] rounded-full bg-live px-[5px] text-center text-[11px] leading-[18px] font-semibold text-primary-foreground',
      className,
    )}>{text}</span
  >
{/if}
