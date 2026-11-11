<script lang="ts">
  import { cn } from '#lib/utils.js'
  import Input from '../input/input.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: ComponentProps<typeof Input> = $props()
</script>

<!-- The group's input: no border or ring of its own, since the group draws them. -->
<Input
  bind:ref
  bind:value
  data-slot="input-group-input"
  class={cn(
    'h-full flex-1 rounded-none border-0 bg-transparent px-2 focus-visible:outline-none first:ps-3 last:pe-3 pointer-coarse:h-full',
    className,
  )}
  {...restProps}
/>
