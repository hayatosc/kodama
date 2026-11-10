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
  import { eyesOf, liftsWings, type AgentColor, type AgentPose, type AgentProp } from './avatar.js'

  let {
    color,
    pose = 'idle',
    prop,
    mark,
    tiny = false,
  }: {
    color: AgentColor
    pose?: AgentPose
    /** Already resolved by the caller: no default is applied here. */
    prop?: AgentProp
    mark?: string
    /** At 28px and below: no feather lines, highlights, bill seam, or cheeks; thicker feet. */
    tiny?: boolean
  } = $props()

  const faceClip = $props.id()

  const cap = $derived(`var(--agent-${color})`)
  const dark = $derived(`color-mix(in srgb, ${cap} 80%, #3e3157)`)
  const edge = $derived(`color-mix(in srgb, ${cap} 22%, #fffcf6)`)
  const lifted = $derived(liftsWings(pose))
  const wing = $derived(pose === 'stretch' ? WING_STRETCHED : lifted ? WING_RAISED : WING_FOLDED)
  const eyes = $derived(eyesOf(pose))
</script>

{#snippet eye(mirrored: boolean)}
  {#if eyes === 'closed'}
    <path class="lid" d="M-1.3 0q1.3 1.4 2.6 0" />
  {:else if eyes === 'happy'}
    <path class="lid" d="M-1.3 .35q1.3-2.2 2.6 0" />
  {:else if eyes === 'wide'}
    <ellipse rx="1.65" ry="2" class="eye" />
    <circle cx="-.45" cy="-.7" r=".46" class="hl" />
  {:else if eyes === 'cross'}
    <path class="lid" d="M-1.2-1.2 1.2 1.2M1.2-1.2-1.2 1.2" />
  {:else if eyes === 'worried'}
    <circle cy=".4" r="1.25" class="eye" />
    <path class="lid" d={mirrored ? 'M1.5-2.9l-2.8 .9' : 'M-1.5-2.9l2.8 .9'} />
  {:else}
    <ellipse rx="1.35" ry="1.65" class="eye" />
    <circle cx="-.4" cy="-.6" r=".36" class="hl" />
  {/if}
{/snippet}

<g class={['bird', `p-${pose}`, tiny && 'tiny']} style:--hue-dark={dark} style:--hue-edge={edge}>
  <g class="breath">
    <g class="bod">
      <g class="tail">
        <path d={TAIL} fill={cap} />
        <path d={TAIL} fill="#453464" opacity=".13" />
      </g>
      <path class="feet" d={FEET} />
      {#if lifted}
        <path d={FAR_WING} fill={dark} />
      {/if}
      <path class="body-edge" d={BODY} fill={cap} />
      <defs>
        <clipPath id={faceClip}><path d={BODY} /></clipPath>
      </defs>
      <path class="facewhite" clip-path={`url(#${faceClip})`} d={FACE} />
      <g class="wing">
        <path d={wing} fill={cap} />
        <path d={wing} fill="#453464" opacity=".10" />
        {#if !lifted}
          <path class="featherlines" d="M-12.1 5.8q-.7 2.1-2 3.2M-8.6 6.2q-1 2.2-2.8 3.3" />
        {/if}
      </g>
      {#if prop === 'pen'}
        <g>
          <rect x=".5" y="3.8" width="10" height="8" rx="1.3" class="paper" />
          <path class="ink" d="M2.2 6.5H8" />
          <path class="ink ink-2" d="M2.2 9h4" />
        </g>
      {/if}
      <g>
        <ellipse class="blush" cx="-3.3" cy="-.8" rx="1.65" ry="1.1" />
        <ellipse class="blush" cx="11.2" cy="-1.1" rx="1.4" ry=".95" />
        <g class="eyes">
          <g transform="translate(-2.2,-3.8)">{@render eye(false)}</g>
          <g transform="translate(10.2,-4) scale(.92)">{@render eye(true)}</g>
        </g>
        <g transform="translate(0,.65)">
          <path class="beak" d="M1.4-2.3 6.5-3 8.3-2.1Q7.6 .5 5 .6 2.7 .8 1.4-2.3Z" />
          <path class="beak-top" d="M1.4-2.3Q1.9-4.7 4.2-5.2 6.1-5.3 8.3-2.1L5.2-1.1Z" />
          <path class="bill-line" d="M1.6-2.2 5.2-1.1 8.1-2" />
        </g>
        {#if prop === 'letter'}
          <g transform="translate(1.5,3.5) rotate(-8)">
            <rect width="12" height="8.4" rx="1.6" class="paper" />
            <path d="M1 1.2l5 3.4 5-3.4" class="fold" />
          </g>
        {:else if prop === 'lens'}
          <g transform="translate(-.6,.3)">
            <path d="M-4.3 -.4l-3.6 4.5" class="handle" />
            <circle cx="-1.6" cy="-4.1" r="4.4" class="glass" />
          </g>
        {:else if prop === 'pen'}
          <g class="pen">
            <path class="pen-body" d="M12.4 1.4L7.6 7.6" />
            <path class="pen-tip" d="M7.6 7.6l-.9 1.5 1.6-.6z" />
          </g>
        {/if}
      </g>
    </g>
  </g>
  {#if mark}
    <text class="mark" x="13" y="-17">{mark}</text>
  {/if}
</g>

<style>
  /* Parts. Colors come from the bird-* tokens, which are the same in both themes. */
  .facewhite,
  .hl {
    fill: var(--bird-face);
  }
  .eye {
    fill: var(--bird-eye);
  }
  .lid {
    fill: none;
    stroke: var(--bird-eye);
    stroke-width: 1.3;
    stroke-linecap: round;
  }
  .blush {
    fill: var(--bird-blush);
    opacity: 0.6;
  }
  .beak {
    fill: var(--bird-beak);
  }
  .beak-top {
    fill: var(--bird-beak-top);
  }
  .bill-line {
    fill: none;
    stroke: var(--bird-bill-line);
    stroke-width: 0.45;
    stroke-linecap: round;
  }
  .feet {
    fill: none;
    stroke: var(--bird-feet);
    stroke-width: 1.35;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .body-edge {
    stroke: var(--hue-edge);
    stroke-width: 0.4;
    stroke-linejoin: round;
  }
  .featherlines {
    fill: none;
    stroke: var(--hue-dark);
    stroke-width: 1.05;
    stroke-linecap: round;
    opacity: 0.6;
  }
  .paper {
    fill: var(--card);
    stroke: var(--input);
    stroke-width: 0.8;
  }
  .fold {
    fill: none;
    stroke: var(--muted-foreground);
    stroke-width: 0.9;
    stroke-linecap: round;
  }
  .ink {
    fill: none;
    stroke: var(--muted-foreground);
    stroke-width: 0.9;
    stroke-linecap: round;
    stroke-dasharray: 6;
    stroke-dashoffset: 0;
  }
  .pen-body {
    fill: none;
    stroke: var(--foreground);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .pen-tip {
    fill: var(--foreground);
  }
  .glass {
    fill: var(--bird-face);
    fill-opacity: 0.25;
    stroke: var(--foreground);
    stroke-width: 1.4;
  }
  .handle {
    stroke: var(--foreground);
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .mark {
    font: 600 9px var(--font-sans);
    fill: var(--foreground);
  }
  .tiny .featherlines,
  .tiny .hl,
  .tiny .bill-line,
  .tiny .blush {
    display: none;
  }
  .tiny .feet {
    stroke-width: 1.8;
  }

  /* Motion (design/components/bundle.css, kd-p-*). Origins are in the bird's units; feet at y 16. */
  .breath,
  .bod {
    transform-origin: 0 16px;
  }
  .wing {
    transform-origin: -4px -1px;
  }
  .tail {
    transform-origin: -13px 8px;
  }
  .eyes {
    transform-origin: 4px -4px;
  }
  .p-idle .breath,
  .p-live .breath,
  .p-worried .breath {
    animation: breathe 3.2s ease-in-out infinite;
  }
  .p-idle .eyes {
    animation: blink 5.2s infinite;
  }
  .p-idle .tail {
    animation: tail 3.2s ease-in-out infinite;
  }
  .p-listen .bod {
    transform: rotate(-7deg);
  }
  .p-write .bod {
    animation: write-head 1.2s ease-in-out infinite;
  }
  .p-write .pen {
    animation: write 1.2s ease-in-out infinite;
  }
  .p-write .ink {
    animation: ink 2.4s linear infinite;
  }
  .p-write .ink-2 {
    animation-delay: 1.2s;
  }
  .p-work .bod {
    animation: search 2.4s ease-in-out infinite;
  }
  .p-happy .bod {
    animation: cheer 0.62s ease-in-out;
  }
  .p-happy .wing,
  .p-live .wing {
    animation: wing-wave 1.4s ease-in-out infinite;
  }
  .p-surprised .bod {
    animation: jump 0.45s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .p-stretch .bod {
    animation: stretch 1s ease-in-out;
  }
  .p-tilt .bod {
    transform: rotate(-13deg);
  }
  .p-worried .bod {
    animation: fidget 2.4s ease-in-out infinite;
  }
  .p-sleep .breath {
    animation: sleep 3.6s ease-in-out infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(1, 1);
    }
    50% {
      transform: scale(1.015, 1.03);
    }
  }
  @keyframes blink {
    0%,
    88%,
    92%,
    95%,
    100% {
      transform: scaleY(1);
    }
    90%,
    93.5% {
      transform: scaleY(0.08);
    }
  }
  @keyframes tail {
    0%,
    100% {
      transform: rotate(0);
    }
    50% {
      transform: rotate(-6deg);
    }
  }
  @keyframes write-head {
    0%,
    100% {
      transform: rotate(0);
    }
    50% {
      transform: rotate(2.5deg);
    }
  }
  @keyframes write {
    0%,
    100% {
      transform: translate(0, 0);
    }
    20% {
      transform: translate(-1.2px, 0.5px);
    }
    40% {
      transform: translate(-2.4px, -0.3px);
    }
    60% {
      transform: translate(-3.4px, 0.5px);
    }
    80% {
      transform: translate(-1.6px, 0.1px);
    }
  }
  @keyframes ink {
    0% {
      stroke-dashoffset: 6;
    }
    50%,
    100% {
      stroke-dashoffset: 0;
    }
  }
  @keyframes search {
    0%,
    100% {
      transform: rotate(0) translateX(0);
    }
    30% {
      transform: rotate(6deg) translateX(0.6px);
    }
    60% {
      transform: rotate(-3deg) translateX(-0.4px);
    }
  }
  @keyframes cheer {
    0%,
    100% {
      transform: translateY(0) scale(1, 1);
    }
    20% {
      transform: translateY(0) scale(1.1, 0.88);
    }
    40% {
      transform: translateY(-4px) scale(0.95, 1.07);
    }
    62% {
      transform: translateY(0) scale(1.06, 0.93);
    }
    80% {
      transform: translateY(-1.6px) scale(0.98, 1.02);
    }
  }
  @keyframes wing-wave {
    0%,
    100% {
      transform: rotate(0deg);
    }
    50% {
      transform: rotate(7deg);
    }
  }
  @keyframes jump {
    40% {
      transform: translateY(-6px) scale(0.96, 1.06);
    }
  }
  @keyframes stretch {
    30% {
      transform: scale(0.9, 1.14);
    }
    50% {
      transform: scale(0.9, 1.14) rotate(-4deg);
    }
    70% {
      transform: scale(0.9, 1.14) rotate(4deg);
    }
    88% {
      transform: scale(1.05, 0.95);
    }
  }
  @keyframes fidget {
    0%,
    70%,
    100% {
      transform: translateX(0);
    }
    78% {
      transform: translateX(-1.2px);
    }
    86% {
      transform: translateX(1.2px);
    }
  }
  @keyframes sleep {
    0%,
    100% {
      transform: scale(1, 1);
    }
    50% {
      transform: scale(1.03, 0.97);
    }
  }

  /* Reduced motion: the pose alone carries the state. */
  @media (prefers-reduced-motion: reduce) {
    .bird * {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
