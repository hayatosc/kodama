<svelte:options namespace="svg" />

<script lang="ts" module>
  /** The body outline: head and body as one round shape, centered on 0,0 with the feet at y 18.5. */
  const BODY =
    'M-14 3C-14-7-7.5-15 1.4-15 10.6-15 15.9-8.3 16 1.6 18.2 8.5 14.8 15.9 3.8 16.4-6.5 17.1-16 13.1-14 3Z'
  const FACE =
    'M-10.7-4.6C-8.5-7.5-4.9-8.7-2.1-8C.5-7.4 2.7-6.5 4.8-6.5C6.9-6.5 8-8.3 10.3-8.2C14.2-8 18.8 1.7 18.6 8.3C18.6 16.9 7.6 20.8-3.7 17.1C-13.2 14.6-13.6 7.6-7.2 2.3C-12.8 2.3-12.7-2-10.7-4.6Z'
  const TAIL =
    'M-11.9 7.9C-14.7 7.1-18.3 6.8-19.9 7.6-22.2 8.9-19.9 10.9-18 10.7L-10.3 10.7ZM-11.6 10.5C-14.2 10.4-17.4 10.8-18.5 12-20 13.7-17.8 14.5-16 13.8L-9.8 12.2Z'
  const FEET =
    'M-3.8 15.5v3M-3.8 16.7l-1.7 1.1M-3.8 16.7l1.7 1.1M7.2 15.4v2.9M7.2 16.5l-1.7 1.1M7.2 16.5l1.7 1.1'
  const WING_FOLDED =
    'M-11.7.2C-16.2 2.8-16.9 8.7-13 11.6-8.4 12.1-3.8 7.1-3.6 2.7-5.2-.3-8.7-.9-11.7.2Z'
  const WING_RAISED =
    'M-11.2 4.8C-15.7 3.2-20.8-2.5-19-6.6-16.1-7-10.4-2.3-8.4 1.1Q-6.8 5.9-11.2 4.8Z'
  const WING_STRETCHED =
    'M-10.8 3.5C-15.9-.4-18.2-8.9-15.8-14.4-13.1-14.1-9.1-6.9-7.8-.2Q-6.8 4.9-10.8 3.5Z'
  const FAR_WING = 'M12.3 2C15.4-1.5 17.8-5.7 19.6-5.5 22.1-1.5 18.7 5.6 14.8 6.3Z'
</script>

<script lang="ts">
  import {
    eyesOf,
    liftsWings,
    type AgentColor,
    type AgentPose,
    type AgentProp,
  } from '../model/avatar.js'

  let {
    color,
    pose = 'idle',
    prop,
    tiny = false,
  }: {
    color: AgentColor
    pose?: AgentPose
    /** Already resolved by the caller: no default is applied here. */
    prop?: AgentProp
    /**
     * At 20px (the design drops the detail at 28px and below, and 20 is the only such size): no
     * feather lines, highlights, bill seam, or cheeks; thicker feet.
     */
    tiny?: boolean
  } = $props()

  const faceClip = $props.id()

  const cap = $derived(`var(--agent-${color})`)
  /**
   * The shading color: the agent's color with its lightness lowered and its hue and chroma kept,
   * so a shadow never pulls another hue (such as purple) into the bird.
   */
  const dark = $derived(`oklch(from ${cap} calc(l * 0.78) c h)`)
  const edge = $derived(`color-mix(in srgb, ${cap} 22%, #fffcf6)`)
  const lifted = $derived(liftsWings(pose))
  const wing = $derived(pose === 'stretch' ? WING_STRETCHED : lifted ? WING_RAISED : WING_FOLDED)
  const eyes = $derived(eyesOf(pose))

  /*
   * Parts. Colors come from the bird-* tokens, which are the same in both themes. At 20px the
   * feather lines, highlights, bill seam, and cheeks are hidden and the feet drawn thicker.
   */
  const lid = 'fill-none stroke-(--bird-eye) [stroke-linecap:round] [stroke-width:1.3]'
  const paper = 'fill-card stroke-input [stroke-width:0.8]'
  const ink =
    'fill-none stroke-muted-foreground [stroke-dasharray:6] [stroke-dashoffset:0] [stroke-linecap:round] [stroke-width:0.9]'
  const hidden = $derived(tiny && 'hidden')

  /*
   * Motion: each pose animates its own parts, with origins in the bird's units (the feet at y 16).
   * Every animation is motion-safe:, so under a reduced-motion request the pose alone carries the
   * state; listen and tilt are still poses either way.
   */
  const breath = $derived(
    pose === 'idle' || pose === 'live' || pose === 'worried'
      ? 'motion-safe:animate-bird-breathe'
      : pose === 'sleep'
        ? 'motion-safe:animate-bird-sleep'
        : undefined,
  )
  const body: Partial<Record<AgentPose, string>> = {
    listen: 'transform-[rotate(-7deg)]',
    tilt: 'transform-[rotate(-13deg)]',
    write: 'motion-safe:animate-bird-write-head',
    work: 'motion-safe:animate-bird-search',
    happy: 'motion-safe:animate-bird-cheer',
    surprised: 'motion-safe:animate-bird-jump',
    stretch: 'motion-safe:animate-bird-stretch',
    worried: 'motion-safe:animate-bird-fidget',
  }
  const waves = $derived(pose === 'happy' || pose === 'live')
</script>

{#snippet eye(mirrored: boolean)}
  {#if eyes === 'closed'}
    <path class={lid} d="M-1.3 0q1.3 1.4 2.6 0" />
  {:else if eyes === 'happy'}
    <path class={lid} d="M-1.3 .35q1.3-2.2 2.6 0" />
  {:else if eyes === 'wide'}
    <ellipse rx="1.65" ry="2" class="fill-(--bird-eye)" />
    <circle cx="-.45" cy="-.7" r=".46" class={['fill-(--bird-face)', hidden]} />
  {:else if eyes === 'cross'}
    <path class={lid} d="M-1.2-1.2 1.2 1.2M1.2-1.2-1.2 1.2" />
  {:else if eyes === 'worried'}
    <circle cy=".4" r="1.25" class="fill-(--bird-eye)" />
    <path class={lid} d={mirrored ? 'M1.5-2.9l-2.8 .9' : 'M-1.5-2.9l2.8 .9'} />
  {:else}
    <ellipse rx="1.35" ry="1.65" class="fill-(--bird-eye)" />
    <circle cx="-.4" cy="-.6" r=".36" class={['fill-(--bird-face)', hidden]} />
  {/if}
{/snippet}

<g style:--hue-dark={dark} style:--hue-edge={edge}>
  <g class={['origin-[0_16px]', breath]}>
    <g class={['origin-[0_16px]', body[pose]]}>
      <g class={['origin-[-13px_8px]', pose === 'idle' && 'motion-safe:animate-bird-tail']}>
        <path d={TAIL} fill={cap} />
        <path d={TAIL} fill={dark} opacity=".4" />
      </g>
      <path
        class={[
          'fill-none stroke-(--bird-feet) [stroke-linecap:round] [stroke-linejoin:round]',
          tiny ? '[stroke-width:1.8]' : '[stroke-width:1.35]',
        ]}
        d={FEET}
      />
      {#if lifted}
        <path d={FAR_WING} fill={dark} />
      {/if}
      <path
        class="stroke-(--hue-edge) [stroke-linejoin:round] [stroke-width:0.4]"
        d={BODY}
        fill={cap}
      />
      <defs>
        <clipPath id={faceClip}><path d={BODY} /></clipPath>
      </defs>
      <path class="fill-(--bird-face)" clip-path={`url(#${faceClip})`} d={FACE} />
      <g class={['origin-[-4px_-1px]', waves && 'motion-safe:animate-bird-wing-wave']}>
        <path d={wing} fill={cap} />
        <path d={wing} fill={dark} opacity=".3" />
        {#if !lifted}
          <path
            class={[
              'fill-none stroke-(--hue-dark) opacity-60 [stroke-linecap:round] [stroke-width:1.05]',
              hidden,
            ]}
            d="M-12.1 5.8q-.7 2.1-2 3.2M-8.6 6.2q-1 2.2-2.8 3.3"
          />
        {/if}
      </g>
      {#if prop === 'pen'}
        <g>
          <rect x=".5" y="3.8" width="10" height="8" rx="1.3" class={paper} />
          <path class={[ink, pose === 'write' && 'motion-safe:animate-bird-ink']} d="M2.2 6.5H8" />
          <path
            class={[
              ink,
              pose === 'write' && 'motion-safe:animate-bird-ink motion-safe:[animation-delay:1.2s]',
            ]}
            d="M2.2 9h4"
          />
        </g>
      {/if}
      <g>
        <ellipse
          class={['fill-(--bird-blush) opacity-60', hidden]}
          cx="-3.3"
          cy="-.8"
          rx="1.65"
          ry="1.1"
        />
        <ellipse
          class={['fill-(--bird-blush) opacity-60', hidden]}
          cx="11.2"
          cy="-1.1"
          rx="1.4"
          ry=".95"
        />
        <g class={['origin-[4px_-4px]', pose === 'idle' && 'motion-safe:animate-bird-blink']}>
          <g transform="translate(-2.2,-3.8)">{@render eye(false)}</g>
          <g transform="translate(10.2,-4) scale(.92)">{@render eye(true)}</g>
        </g>
        <g transform="translate(0,.65)">
          <path class="fill-(--bird-beak)" d="M1.4-2.3 6.5-3 8.3-2.1Q7.6 .5 5 .6 2.7 .8 1.4-2.3Z" />
          <path
            class="fill-(--bird-beak-top)"
            d="M1.4-2.3Q1.9-4.7 4.2-5.2 6.1-5.3 8.3-2.1L5.2-1.1Z"
          />
          <path
            class={[
              'fill-none stroke-(--bird-bill-line) [stroke-linecap:round] [stroke-width:0.45]',
              hidden,
            ]}
            d="M1.6-2.2 5.2-1.1 8.1-2"
          />
        </g>
        {#if prop === 'letter'}
          <g transform="translate(1.5,3.5) rotate(-8)">
            <rect width="12" height="8.4" rx="1.6" class={paper} />
            <path
              d="M1 1.2l5 3.4 5-3.4"
              class="fill-none stroke-muted-foreground [stroke-linecap:round] [stroke-width:0.9]"
            />
          </g>
        {:else if prop === 'lens'}
          <g transform="translate(-.6,.3)">
            <path
              d="M-4.3 -.4l-3.6 4.5"
              class="stroke-foreground [stroke-linecap:round] [stroke-width:2.2]"
            />
            <circle
              cx="-1.6"
              cy="-4.1"
              r="4.4"
              class="fill-(--bird-face) stroke-foreground [fill-opacity:0.25] [stroke-width:1.4]"
            />
          </g>
        {:else if prop === 'pen'}
          <g class={[pose === 'write' && 'motion-safe:animate-bird-write']}>
            <path
              class="fill-none stroke-foreground [stroke-linecap:round] [stroke-width:1.5]"
              d="M12.4 1.4L7.6 7.6"
            />
            <path class="fill-foreground" d="M7.6 7.6l-.9 1.5 1.6-.6z" />
          </g>
        {/if}
      </g>
    </g>
  </g>
</g>
