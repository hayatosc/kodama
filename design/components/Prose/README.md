# Prose

The look of Markdown rendered inside an agent's bubble.

- **What the caller passes:** the full Markdown and whether it is streaming. Rendering is done by the Svelte port of Streamdown (sveltekit.md, "Streaming Markdown"), which closes unclosed syntax so streaming output does not break. Never send model output through as HTML.
- The body is `text-base leading-7` (16/28); gaps between elements are `spacing-2`.
- While streaming, a blinking caret at the end of the last block. Syntax highlighting for a code block applies after the fence closes.
- Headings are only `h3` (18px semibold) and `h4` (16px semibold). `h1` and `h2` fall back to `h3`.
- Lists use `pl-5`, with 2px between items. Links are `text-live underline underline-offset-2`.
- Inline code is `font-mono text-sm bg-accent rounded-sm px-1`.
- Code blocks are `border rounded-lg bg-card`, with a bar above holding the language name and a copy button; the body uses the same syntax colors as ToolCall.
- Quotes have a 2px `border-input` line on the left; the text is `text-muted-foreground`.
- Tables use `text-sm`, the header row `text-muted-foreground`, and a 1px line below each row. Tables that overflow horizontally scroll.
