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
  comes with Streamdown. Long URLs and code break where they must, so a reply never widens a
  phone screen. Wrap a code block in ProseCodeBlock and a table in ProseTable. The elements are
  not Prose's own, so they cannot carry classes: the scoped style below dresses them with @apply.
-->
<div
  bind:this={ref}
  data-slot="prose"
  data-streaming={streaming || undefined}
  class={cn('prose text-base leading-7 wrap-anywhere text-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</div>

<style>
  @reference '../../../app/styles/index.css';

  .prose :global(:where(h1, h2, h3, h4, p, ul, ol, blockquote, figure, table, hr)) {
    @apply my-0;
  }

  /*
   * The rhythm between blocks. Text follows text 8px apart. Code blocks, quotes, tables, and
   * rules stand apart from the text, 16px on each side. A heading opens a section: 24px (h1 to h3)
   * or 16px (h4) from what comes before, and 4px above its own text (8px above a boxed block), so
   * it reads with what follows. The selectors are in :where() so the rules weigh the same and the
   * later one wins.
   */
  .prose > :global(:where(* + *)) {
    @apply mt-2;
  }

  .prose > :global(:where(* + :is(figure, blockquote, [data-slot='prose-table'], hr))),
  .prose > :global(:where(:is(figure, blockquote, [data-slot='prose-table'], hr) + *)) {
    @apply mt-4;
  }

  .prose > :global(:where(* + :is(h1, h2, h3))) {
    @apply mt-6;
  }

  .prose > :global(:where(* + h4)) {
    @apply mt-4;
  }

  .prose > :global(:where(:is(h1, h2, h3, h4) + *)) {
    @apply mt-1;
  }

  .prose
    > :global(
      :where(:is(h1, h2, h3, h4) + :is(figure, blockquote, [data-slot='prose-table'], hr))
    ) {
    @apply mt-2;
  }

  /* h1 and h2 look like h3. */
  .prose :global(:is(h1, h2, h3)) {
    @apply text-lg leading-7 font-semibold;
  }

  .prose :global(h4) {
    @apply text-base leading-7 font-semibold;
  }

  .prose :global(ul) {
    @apply list-disc ps-5;
  }

  .prose :global(ol) {
    @apply list-decimal ps-5;
  }

  .prose :global(li + li) {
    @apply mt-1;
  }

  .prose :global(strong) {
    @apply font-semibold;
  }

  .prose :global(a) {
    @apply text-live underline decoration-1 underline-offset-2;
  }

  .prose :global(:not(pre) > code) {
    @apply rounded-sm bg-accent px-1 font-mono text-sm/7;
  }

  .prose :global(blockquote) {
    @apply border-s-2 border-s-input ps-3 text-muted-foreground;
  }

  .prose :global(table) {
    @apply w-full border-collapse text-sm leading-5;
  }

  .prose :global(th) {
    @apply text-start font-normal text-muted-foreground;
  }

  .prose :global(:is(th, td)) {
    @apply border-b border-border px-2 py-1.5;
  }

  .prose :global(hr) {
    @apply border-x-0 border-t border-b-0 border-border;
  }

  /* The caret is generated content with no text, so screen readers pass over it. */
  .prose[data-streaming] > :global(:last-child)::after {
    content: '';
    @apply ms-0.5 inline-block h-3.75 w-1.75 bg-foreground translate-y-0.5 forced-colors:bg-[CanvasText] motion-safe:animate-caret;
  }
</style>
