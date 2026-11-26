<script lang="ts">
  import { cn } from '#shared/lib/utils.js'
  import { settingsRow } from './row.js'

  let {
    label,
    hint,
    value,
    mono = true,
    class: className,
  }: {
    label: string
    /** One sentence under the label. */
    hint?: string
    /** Read-only, such as 「09:00 毎日」. */
    value: string
    /** Times and identifiers are monospaced; turn it off for words. */
    mono?: boolean
    class?: string
  } = $props()
</script>

<!-- A read-only value at the right edge, muted. -->
<div data-slot="settings-row" class={cn(settingsRow, className)}>
  <span class="flex min-w-0 flex-col py-[7px]">
    <span>{label}</span>
    {#if hint}<span class="text-xs text-muted-foreground">{hint}</span>{/if}
  </span>
  <span class={cn('pe-2 text-sm text-muted-foreground', mono && 'font-mono')}>{value}</span>
</div>
