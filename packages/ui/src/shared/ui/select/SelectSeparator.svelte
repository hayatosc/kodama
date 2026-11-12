<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLHRElement>, HTMLHRElement> = $props()
</script>

<!-- An <hr>, which the HTML parser allows inside <select> between options and groups. -->
<hr bind:this={ref} data-slot="select-separator" class={cn(className)} {...restProps} />
