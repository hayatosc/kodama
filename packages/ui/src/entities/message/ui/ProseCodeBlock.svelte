<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import CopyButton from './CopyButton.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    language,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    /** The fence's language, shown in the bar above the code. */
    language: string
  } = $props()

  const codeId = $props.id()
</script>

<!--
  A fenced code block in a reply: a bar with the language and a copy button above the code. The
  code is the children, plain or with highlighted spans (text-live keywords, text-running strings,
  text-destructive numbers, text-muted-foreground comments, the same colors as ToolCall); Shiki
  highlighting comes with Streamdown, applied once the fence closes. Long lines wrap.
-->
<figure
  bind:this={ref}
  data-slot="prose-code-block"
  class={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
  {...restProps}
>
  <figcaption
    class="flex h-[30px] items-center justify-between border-b border-border ps-3 pe-1.5 font-mono text-xs text-muted-foreground"
  >
    {language}
    <CopyButton for={codeId} what={`${language} のコード`} />
  </figcaption>
  <pre
    id={codeId}
    class="m-0 px-3 py-2.5 font-mono text-sm leading-5 break-words whitespace-pre-wrap text-foreground"><code
      >{@render children?.()}</code
    ></pre>
</figure>
