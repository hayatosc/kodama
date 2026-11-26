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

  /**
   * The rhythm between blocks. Text follows text 8px apart. Code blocks, quotes, tables, and rules
   * stand apart from the text, 16px on each side. A heading opens a section: 24px (h1 to h3) or
   * 16px (h4) from what comes before, and 4px above its own text (8px above a boxed block), so it
   * reads with what follows. Each rule matches what no other one does, so none depends on which
   * comes later; the first child and nested blocks have no top margin. Tailwind reads class names
   * whole, so the selector lists are written out in each.
   */
  const rhythm = [
    '[&_:where(h1,h2,h3,h4,p,ul,ol,blockquote,figure,table,hr)]:mb-0',
    '[&_*_:where(h1,h2,h3,h4,p,ul,ol,blockquote,figure,table,hr)]:mt-0',
    '[&>:where(h1,h2,h3,h4,p,ul,ol,blockquote,figure,table,hr):first-child]:mt-0',
    '[&>:where(:is(h1,h2,h3,h4)+:is(figure,blockquote,[data-slot=prose-table],hr))]:mt-2',
    '[&>:where(:is(h1,h2,h3,h4)+:not(figure,blockquote,[data-slot=prose-table],hr))]:mt-1',
    '[&>:where(:not(h1,h2,h3,h4)+:is(h1,h2,h3))]:mt-6',
    '[&>:where(:not(h1,h2,h3,h4)+h4)]:mt-4',
    '[&>:where(:not(h1,h2,h3,h4)+:is(figure,blockquote,[data-slot=prose-table],hr))]:mt-4',
    '[&>:where(:is(figure,blockquote,[data-slot=prose-table],hr)+:not(h1,h2,h3,h4,figure,blockquote,[data-slot=prose-table],hr))]:mt-4',
    '[&>:where(:not(h1,h2,h3,h4,figure,blockquote,[data-slot=prose-table],hr)+:not(h1,h2,h3,h4,figure,blockquote,[data-slot=prose-table],hr))]:mt-2',
  ]

  /** The elements Markdown renders; h1 and h2 look like h3. */
  const elements = [
    '[&_:is(h1,h2,h3)]:text-[18px] [&_:is(h1,h2,h3)]:leading-7 [&_:is(h1,h2,h3)]:font-semibold',
    '[&_h4]:text-[16px] [&_h4]:leading-7 [&_h4]:font-semibold',
    '[&_:is(ul,ol)]:ps-5 [&_ul]:list-disc [&_ol]:list-decimal [&_li+li]:mt-1',
    '[&_strong]:font-semibold',
    '[&_a]:text-live [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2',
    '[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-accent [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[14px]',
    '[&_blockquote]:border-s-2 [&_blockquote]:border-s-input [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground',
    '[&_table]:w-full [&_table]:border-collapse [&_table]:text-[14px] [&_table]:leading-5',
    '[&_th]:text-start [&_th]:font-normal [&_th]:text-muted-foreground',
    '[&_:is(th,td)]:border-b [&_:is(th,td)]:border-border [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1.5',
    '[&_hr]:border-x-0 [&_hr]:border-t [&_hr]:border-b-0 [&_hr]:border-border',
  ]

  /** The caret is generated content with no text, so screen readers pass over it. */
  const caret =
    'data-streaming:[&>:last-child]:after:ms-0.5 data-streaming:[&>:last-child]:after:inline-block data-streaming:[&>:last-child]:after:h-[15px] data-streaming:[&>:last-child]:after:w-[7px] data-streaming:[&>:last-child]:after:bg-foreground data-streaming:[&>:last-child]:after:align-[-2px] forced-colors:data-streaming:[&>:last-child]:after:bg-[CanvasText] motion-safe:data-streaming:[&>:last-child]:after:animate-caret'
</script>

<!--
  The look of Markdown rendered in an agent's reply (design/components/Prose). It only styles
  what it is given, block elements as Markdown renders them; turning Markdown into elements
  comes with Streamdown. Long URLs and code break where they must, so a reply never widens a
  phone screen. Wrap a code block in ProseCodeBlock and a table in ProseTable.
-->
<div
  bind:this={ref}
  data-slot="prose"
  data-streaming={streaming || undefined}
  class={cn('text-base leading-7 wrap-anywhere text-foreground', rhythm, elements, caret, className)}
  {...restProps}
>
  {@render children?.()}
</div>
