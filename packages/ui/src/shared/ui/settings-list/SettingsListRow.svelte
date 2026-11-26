<script lang="ts">
  import { cn } from '#shared/lib/utils.js'
  import { setFieldState } from '../field/context.js'
  import { settingsRow } from './row.js'
  import type { Snippet } from 'svelte'

  let {
    label,
    hint,
    class: className,
    children,
  }: {
    label: string
    /** One sentence under the label. */
    hint?: string
    class?: string
    /** The control at the right edge: a Switch, a Combobox, or a Select. */
    children: Snippet
  } = $props()

  const id = $props.id()

  // The row is a field: the control inside takes its id from it, so the label names it and the
  // hint describes it without ids written by hand.
  setFieldState({
    id,
    invalid: false,
    get described() {
      return hint !== undefined
    },
    set described(_) {},
    erred: false,
  })
</script>

<div data-slot="settings-row" class={cn(settingsRow, className)}>
  <span class="flex min-w-0 flex-col py-[7px]">
    <label for={`${id}-control`}>{label}</label>
    {#if hint}
      <span id={`${id}-description`} class="text-xs text-muted-foreground">{hint}</span>
    {/if}
  </span>
  {@render children()}
</div>
