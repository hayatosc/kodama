<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { setAvatarState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props()

  let status = $state<'loading' | 'loaded' | 'error'>('loading')
  let hasImage = $state(false)
  setAvatarState({
    get status() {
      return status
    },
    set status(next) {
      status = next
    },
    get hasImage() {
      return hasImage
    },
    set hasImage(next) {
      hasImage = next
    },
  })
</script>

<!-- A 32px circle holding a person's picture, or their initials until it loads or if it fails. -->
<span
  bind:this={ref}
  data-slot="avatar"
  class={cn(
    'relative inline-flex size-8 shrink-0 overflow-hidden rounded-full border border-border bg-muted',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</span>
