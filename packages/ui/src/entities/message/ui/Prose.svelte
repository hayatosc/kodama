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

  .prose :global(:is(h1, h2, h3, h4, p, ul, ol, blockquote, figure, table, hr)) {
    margin-block: 0;
  }

  .prose > :global(* + *) {
    margin-block-start: var(--spacing-2);
  }

  .prose :global(:is(h1, h2, h3)) {
    padding-block-start: 4px;
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
    margin-block-start: 2px;
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
