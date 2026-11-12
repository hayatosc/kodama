<script lang="ts">
  import { onDestroy } from 'svelte'
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getAvatarState } from './context.js'
  import type { HTMLImgAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    alt,
    ...restProps
  }: WithElementRef<HTMLImgAttributes, HTMLImageElement> & {
    /** The person's name, or "" when the name is already next to the avatar. */
    alt: string
  } = $props()

  const avatar = getAvatarState()
  avatar.hasImage = true
  onDestroy(() => (avatar.hasImage = false))
</script>

<!--
  The picture, shown once it has loaded; the fallback stays until then, or for good if it fails.
  It is only transparent until then, so its alt text names the avatar the whole time.
-->
<img
  bind:this={ref}
  data-slot="avatar-image"
  {alt}
  class={cn(
    'absolute inset-0 size-full object-cover',
    avatar.status !== 'loaded' && 'opacity-0',
    className,
  )}
  onload={() => (avatar.status = 'loaded')}
  onerror={() => (avatar.status = 'error')}
  {...restProps}
/>
