<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#lib/utils.js'

  let {
    streaming = false,
    class: className,
    children,
  }: {
    /** Shows a blinking caret after the last block while the reply is still arriving. */
    streaming?: boolean
    class?: string
    children: Snippet
  } = $props()
</script>

<!--
  The look of rendered Markdown (design/components/Prose). It styles the elements it is given and
  never parses Markdown or takes HTML: the Streamdown port will render into it. Wrap a table in
  `.table-scroll` so a wide one scrolls sideways.
-->
<div class={cn('prose text-base leading-7 text-foreground', streaming && 'streaming', className)}>
  {@render children()}
</div>

<style>
  .prose > :global(* + *) {
    margin-top: 8px;
  }
  /* Only two heading levels: h1 and h2 fall back to the h3 style. */
  .prose :global(:is(h1, h2, h3)) {
    padding-top: 4px;
    font: 600 18px/28px var(--font-sans);
  }
  .prose :global(h4) {
    font: 600 16px/28px var(--font-sans);
  }
  .prose :global(:is(ul, ol)) {
    padding-left: 20px;
  }
  .prose :global(ul) {
    list-style: disc;
  }
  .prose :global(ol) {
    list-style: decimal;
  }
  .prose :global(li + li) {
    margin-top: 2px;
  }
  .prose :global(a) {
    color: var(--live);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-thickness: 1px;
  }
  .prose :global(strong) {
    font-weight: 600;
  }
  .prose :global(:not(pre) > code) {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--accent);
    font: 14px var(--font-mono);
  }
  .prose :global(blockquote) {
    padding-left: 12px;
    border-left: 2px solid var(--input);
    color: var(--muted-foreground);
  }
  .prose :global(.table-scroll) {
    overflow-x: auto;
  }
  .prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    line-height: 20px;
  }
  .prose :global(th) {
    text-align: left;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .prose :global(:is(th, td)) {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .prose :global(hr) {
    border: 0;
    border-top: 1px solid var(--border);
  }

  /* The caret follows the last block's text, or the last item of a closing list. */
  .streaming > :global(:last-child:not(ul, ol)::after),
  .streaming > :global(:last-child:is(ul, ol) > li:last-child::after) {
    content: '';
    display: inline-block;
    width: 7px;
    height: 15px;
    margin-left: 2px;
    vertical-align: -2px;
    background: var(--foreground);
    animation: caret 1s steps(2) infinite;
  }
  @keyframes caret {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .streaming > :global(*::after),
    .streaming > :global(* > li::after) {
      animation: none !important;
    }
  }
</style>
