<script lang="ts">
  import { cn } from '#shared/lib/utils.js'
  import {
    badgeOf,
    defaultProp,
    isHome,
    scaleOf,
    type AgentColor,
    type AgentMark,
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
    mark?: AgentMark
    /** 72 profile, 56 main row, 40 phone list, 36 list rows, 32 phone app bar, 20 inline. */
    size?: 20 | 32 | 36 | 40 | 56 | 72
    /** The lower-right status badge; hidden at 20px and while the bird holds something. */
    badge?: boolean
    /**
     * The accessible name; without it the avatar is decorative. Name the agent (its slug) when
     * the text beside the avatar already says what it is doing, as a list row's second line does;
     * when the avatar stands alone, include the state too, such as `research: 書いています`.
     */
    label?: string
    class?: string
  } = $props()

  const discClip = $props.id()

  const home = $derived(isHome(pose))
  /**
   * At 20px the face alone has to carry the pose: no fine detail (the design's 28px-and-below
   * rule, and 20 is the only size that small), no prop, no mark, no badge.
   */
  const tiny = $derived(size <= 20)
  const held = $derived(
    size <= 20 ? undefined : prop === undefined ? defaultProp(pose) : (prop ?? undefined),
  )
  const shownMark = $derived(size > 20 ? mark : undefined)
  const badgeKind = $derived(badge && size > 20 && held === undefined ? badgeOf(pose) : undefined)

  /** Each z is smaller than the one before and starts a second later. */
  const zs = [
    { x: 4.2, y: 0.6, font: '[font:600_7px_var(--font-sans)]' },
    { x: 7.6, y: -4.2, font: '[font:600_6px_var(--font-sans)] motion-safe:[animation-delay:1s]' },
    { x: 10.6, y: -8.6, font: '[font:600_5px_var(--font-sans)] motion-safe:[animation-delay:2s]' },
  ]
</script>

<span
  class={cn('relative inline-block size-(--size) shrink-0', className)}
  style:--size={`${size}px`}
  style:--hue={`var(--agent-${color})`}
  role={label === undefined ? undefined : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
  data-pose={pose}
>
  <!--
    The avatar looks exactly the same in light and dark, so the surfaces it draws with are fixed to
    the light values. Only the badge's ring follows the surface the avatar sits on.
  -->
  <svg
    viewBox="-20 -20 40 40"
    class={[
      'block size-full overflow-hidden [--background:#ffffff] [--card:#ffffff] [--foreground:#0a0a0a] [--house-hole:#2b2b2b] [--input:#767676] [--muted-foreground:#636363]',
      pose === 'paused' && 'grayscale',
    ]}
  >
    <defs>
      <clipPath id={discClip}><circle r="20" /></clipPath>
    </defs>
    <circle r="20" class="fill-[color-mix(in_oklab,var(--hue)_18%,var(--background))]" />
    <g clip-path={`url(#${discClip})`}>
      {#if home}
        <g transform="translate(-27.8,-29.5) scale(.5)">
          <Birdhouse {color} tint />
        </g>
        {#if pose === 'sleep' && size > 20}
          <!-- While asleep, z's rise from the hole one after another and fade. -->
          <g>
            {#each zs as z (z.x)}
              <text
                x={z.x}
                y={z.y}
                class={[
                  'origin-center fill-(--bird-face) stroke-[oklch(from_var(--hue)_calc(l*0.55)_c_h)] [paint-order:stroke] [stroke-linejoin:round] [stroke-width:1.2px] [transform-box:fill-box] motion-safe:animate-avatar-z motion-safe:opacity-0',
                  z.font,
                ]}>z</text
              >
            {/each}
          </g>
        {/if}
      {:else}
        <g transform={`translate(2.2,.2) scale(${scaleOf(pose)})`}>
          <Bird {color} {pose} prop={held} {tiny} />
        </g>
      {/if}
    </g>
    {#if shownMark}
      <text class="fill-foreground [font:600_11px_var(--font-sans)]" x="11" y="-10"
        >{shownMark}</text
      >
    {/if}
  </svg>
  {#if badgeKind}
    <span
      class={[
        'absolute -right-0.5 -bottom-0.5 size-[30%] min-h-2.5 min-w-2.5 rounded-full [box-shadow:0_0_0_2px_var(--badge-ring,var(--background))]',
        badgeKind === 'live' ? 'bg-[#2563eb]' : 'bg-[#c42020]',
      ]}
    ></span>
  {/if}
</span>
