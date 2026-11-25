<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    heading,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** The section heading above the card, such as 「設定」 or 「ルーティン」. */
    heading?: string
  } = $props()

  const id = $props.id()
  const headingId = `${id}-heading`
</script>

<!--
  design/components/SettingsList: a card of rows (rounded-xl, 1px border, 4px padding above and
  below), each row a label at the left and one thing at the right: a value, a control, or a
  destructive action at the end. With a heading, the card is a section named by it.
-->
{#snippet card()}
  <div
    bind:this={ref}
    data-slot="settings-list"
    class={cn('rounded-xl border border-border py-1', className)}
    {...restProps}
  >
    {@render children?.()}
  </div>
{/snippet}

{#if heading}
  <section aria-labelledby={headingId} class="flex flex-col gap-2">
    <h3 id={headingId} class="px-1 text-xs font-normal text-muted-foreground">{heading}</h3>
    {@render card()}
  </section>
{:else}
  {@render card()}
{/if}
