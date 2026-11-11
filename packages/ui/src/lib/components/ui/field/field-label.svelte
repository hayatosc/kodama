<script lang="ts">
  import { cn } from '#lib/utils.js'
  import Label from '../label/label.svelte'
  import type { ComponentProps } from 'svelte'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ComponentProps<typeof Label> = $props()
</script>

<Label bind:ref data-slot="field-label" class={cn(className)} {...restProps} />
