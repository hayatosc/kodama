<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getAvatarState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props()

  const avatar = getAvatarState()
</script>

<!--
  Initials while the picture loads, or when there is none; gone once the picture shows. With an
  Image present, the image's alt names the avatar, so the initials are hidden from assistive
  technology.
-->
{#if avatar.status !== 'loaded'}
  <span
    bind:this={ref}
    data-slot="avatar-fallback"
    aria-hidden={avatar.hasImage || undefined}
    class={cn(
      'flex size-full items-center justify-center text-xs font-semibold text-muted-foreground',
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
  </span>
{/if}
