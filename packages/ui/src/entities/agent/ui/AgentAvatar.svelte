<script lang="ts">
  import { cn } from '#shared/lib/utils.js'
  import {
    badgeOf,
    defaultProp,
    isHome,
    scaleOf,
    type AgentColor,
    type AgentPose,
    type AgentProp,
  } from '../model/avatar.js'
  import Bird from './Bird.svelte'
  import Birdhouse from './Birdhouse.svelte'

  let {
    color,
    pose = 'idle',
    prop,
    mark,
    size = 36,
    badge = true,
    label,
    class: className,
  }: {
    /** `ink` is reserved for the main agent, `system` for dedicated agents. */
    color: AgentColor
    /** Derived from the event stream; `sleep` and `paused` draw the birdhouse instead. */
    pose?: AgentPose
    /** Defaults by pose (`work` holds the lens, `write` the pen); `null` holds nothing. */
    prop?: AgentProp | null
    /** `?` or `!`, above the head. */
    mark?: string
    /** 72 profile, 56 main row, 40 phone list, 36 list rows, 32 phone app bar, 20 inline. */
    size?: 20 | 32 | 36 | 40 | 56 | 72
    /** The lower-right status badge; hidden at 20px and while the bird holds something. */
    badge?: boolean
    /** The accessible name, such as the agent's slug; without it the avatar is decorative. */
    label?: string
    class?: string
  } = $props()

  const discClip = $props.id()

  const home = $derived(isHome(pose))
  const tiny = $derived(size <= 28)
  /** At 20px the face alone has to carry the pose: no prop, no mark, no badge. */
  const held = $derived(
    size <= 20 ? undefined : prop === undefined ? defaultProp(pose) : (prop ?? undefined),
  )
  const shownMark = $derived(size > 20 ? mark : undefined)
  const badgeKind = $derived(badge && size > 20 && held === undefined ? badgeOf(pose) : undefined)
</script>

<span
  class={cn('avatar relative inline-block shrink-0', className)}
  style:--size={`${size}px`}
  style:--hue={`var(--agent-${color})`}
  role={label === undefined ? undefined : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
  data-pose={pose}
>
  <svg viewBox="-20 -20 40 40" class={['disc', pose === 'paused' && 'paused']}>
    <defs>
      <clipPath id={discClip}><circle r="20" /></clipPath>
    </defs>
    <circle r="20" class="fill" />
    <g clip-path={`url(#${discClip})`}>
      {#if home}
        <g transform="translate(-27.8,-29.5) scale(.5)">
          <Birdhouse {color} tint />
        </g>
        {#if pose === 'sleep' && size > 20}
          <g class="z">
            <text x="4.2" y=".6">z</text>
            <text x="7.6" y="-4.2">z</text>
            <text x="10.6" y="-8.6">z</text>
          </g>
        {/if}
      {:else}
        <g transform={`translate(2.2,.2) scale(${scaleOf(pose)})`}>
          <Bird {color} {pose} prop={held} {tiny} />
        </g>
      {/if}
    </g>
    {#if shownMark}
      <text class="mark" x="11" y="-10">{shownMark}</text>
    {/if}
  </svg>
  {#if badgeKind}
    <span class={['badge', badgeKind]}></span>
  {/if}
</span>

<style>
  .avatar {
    width: var(--size);
    height: var(--size);
  }
  /*
   * The avatar looks exactly the same in light and dark, so the surfaces it draws with are fixed
   * to the light values. Only the badge's ring follows the surface the avatar sits on.
   */
  .disc {
    --background: #ffffff;
    --foreground: #0a0a0a;
    --card: #ffffff;
    --input: #767676;
    --muted-foreground: #636363;
    --house-hole: #2b2b2b;
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .fill {
    fill: color-mix(in oklab, var(--hue) 18%, var(--background));
  }
  .paused {
    filter: grayscale(1);
  }
  .mark {
    font: 600 11px var(--font-sans);
    fill: var(--foreground);
  }
  .badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 30%;
    height: 30%;
    min-width: 10px;
    min-height: 10px;
    border-radius: 9999px;
    box-shadow: 0 0 0 2px var(--badge-ring, var(--background));
  }
  .badge.live {
    background: #2563eb;
  }
  .badge.error {
    background: #c42020;
  }

  /* While asleep, z's rise from the hole one after another and fade. */
  .z text {
    font: 600 7px var(--font-sans);
    fill: var(--bird-face);
    paint-order: stroke;
    stroke: color-mix(in oklab, var(--hue) 55%, #000);
    stroke-width: 1.2px;
    stroke-linejoin: round;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: z 3s ease-out infinite;
  }
  .z text:nth-child(2) {
    font-size: 6px;
    animation-delay: 1s;
  }
  .z text:nth-child(3) {
    font-size: 5px;
    animation-delay: 2s;
  }
  @keyframes z {
    0% {
      opacity: 0;
      transform: translate(-3px, 4px) scale(0.6);
    }
    20%,
    75% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(1px, -1.5px) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .z text {
      animation: none;
      opacity: 1;
    }
  }
</style>
