<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props()
</script>

<!--
  An input with addons (icons, text, buttons) inside one border. The group draws the focus ring
  while its input has keyboard focus, and the destructive border while it is invalid.
-->
<div
  bind:this={ref}
  data-slot="input-group"
  role="group"
  class={cn(
    'flex h-9 w-full min-w-0 items-center rounded-lg border border-input bg-background pointer-coarse:h-12',
    'has-[input:user-invalid]:border-destructive has-[[aria-invalid=true]]:border-destructive',
    'has-[input:disabled]:opacity-40',
    'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
