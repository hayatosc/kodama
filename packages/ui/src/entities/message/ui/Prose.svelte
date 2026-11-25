<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    streaming = false,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** While the reply is still arriving, a blinking caret follows the last block. */
    streaming?: boolean
  } = $props()
</script>

<!--
  The look of Markdown rendered in an agent's reply (design/components/Prose). It only styles
  what it is given, block elements as Markdown renders them; turning Markdown into elements
  comes with Streamdown. h1 and h2 look like h3. Wrap a code block in ProseCodeBlock and a table
  in ProseTable.
-->
<div
  bind:this={ref}
  data-slot="prose"
  data-streaming={streaming || undefined}
  class={cn('prose text-base leading-7 text-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</div>

<style>
  /* Long URLs and code break where they must, so a reply never widens a phone screen. */
  .prose {
    overflow-wrap: anywhere;
  }

  .prose :global(:where(h1, h2, h3, h4, p, ul, ol, blockquote, figure, table, hr)) {
    margin-block: 0;
  }

  /*
   * The rhythm between blocks. Text follows text 8px apart. Code blocks, quotes, tables, and
   * rules stand apart from the text, 16px on each side. A heading opens a section: 24px (h3) or
   * 16px (h4) from what comes before, and 4px above its own text (8px above a boxed block), so it
   * reads with what follows.
   * The selectors are in :where() so the rules weigh the same and the later one wins.
   */
  .prose > :global(:where(* + *)) {
    margin-block-start: var(--spacing-2);
  }

  .prose > :global(:where(* + :is(figure, blockquote, [data-slot='prose-table'], hr))),
  .prose > :global(:where(:is(figure, blockquote, [data-slot='prose-table'], hr) + *)) {
    margin-block-start: var(--spacing-4);
  }

  .prose > :global(:where(* + :is(h1, h2, h3))) {
    margin-block-start: var(--spacing-6);
  }

  .prose > :global(:where(* + h4)) {
    margin-block-start: var(--spacing-4);
  }

  .prose > :global(:where(:is(h1, h2, h3, h4) + *)) {
    margin-block-start: var(--spacing-1);
  }

  .prose
    > :global(
      :where(:is(h1, h2, h3, h4) + :is(figure, blockquote, [data-slot='prose-table'], hr))
    ) {
    margin-block-start: var(--spacing-2);
  }

  .prose :global(:is(h1, h2, h3)) {
    font-size: 18px;
    font-weight: 600;
    line-height: 28px;
  }

  .prose :global(h4) {
    font-size: 16px;
    font-weight: 600;
    line-height: 28px;
  }

  .prose :global(:is(ul, ol)) {
    padding-inline-start: 20px;
  }

  .prose :global(ul) {
    list-style: disc;
  }

  .prose :global(ol) {
    list-style: decimal;
  }

  .prose :global(li + li) {
    margin-block-start: var(--spacing-1);
  }

  .prose :global(strong) {
    font-weight: 600;
  }

  .prose :global(a) {
    color: var(--live);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }

  .prose :global(:not(pre) > code) {
    padding-inline: var(--spacing-1);
    border-radius: var(--radius-sm);
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .prose :global(blockquote) {
    padding-inline-start: var(--spacing-3);
    border-inline-start: 2px solid var(--input);
    color: var(--muted-foreground);
  }

  .prose :global(table) {
    inline-size: 100%;
    border-collapse: collapse;
    font-size: 14px;
    line-height: 20px;
  }

  .prose :global(th) {
    font-weight: 400;
    text-align: start;
    color: var(--muted-foreground);
  }

  .prose :global(:is(th, td)) {
    padding: 6px 8px;
    border-block-end: 1px solid var(--border);
  }

  .prose :global(hr) {
    border: 0;
    border-block-start: 1px solid var(--border);
  }

  /* The caret is generated content with no text, so screen readers pass over it. */
  .prose[data-streaming] > :global(:last-child)::after {
    content: '';
    display: inline-block;
    inline-size: 7px;
    block-size: 15px;
    margin-inline-start: 2px;
    vertical-align: -2px;
    background: var(--foreground);
  }

  @media (prefers-reduced-motion: no-preference) {
    .prose[data-streaming] > :global(:last-child)::after {
      animation: blink 1s steps(2) infinite;
    }
  }

  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }

  @media (forced-colors: active) {
    .prose[data-streaming] > :global(:last-child)::after {
      background: CanvasText;
    }
  }
</style>
