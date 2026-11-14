<svelte:options namespace="svg" />

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AgentColor } from '../model/avatar.js'

  let {
    color,
    tint = false,
    inside,
  }: {
    /** The agent's color: only the flag in the shared birdhouse, the walls when `tint` is set. */
    color: AgentColor
    /** The avatar's version: walls in the agent's color, darker side, roof, and post; no flag. */
    tint?: boolean
    /** Drawn over the dark hole, below the perch: the bird peeking out (hole center 58,62). */
    inside?: Snippet
  } = $props()
</script>

<!-- Units of viewBox "10 10 100 112": hole center 58,62; perch top at y 77.5. -->
<g class={['house', tint && 'tint']} style:--hue={`var(--agent-${color})`}>
  <ellipse cx="56" cy="119.5" rx="15" ry="2" class="ground" />
  <rect x="52" y="96" width="9" height="24" rx="3" class="post" />
  <path d="M38 52L26 45v48c0 2 1 3.4 3 4l9 3.6z" class="wood-side" />
  <path
    d="M38 52L58 34 78 52v45.5c0 1.4-1.1 2.5-2.5 2.5h-35c-1.4 0-2.5-1.1-2.5-2.5z"
    class="wood"
  />
  <g class="flag">
    <path d="M47.5 27.2V13.5" class="pole" />
    <path d="M47.8 13.6l9.6 2.9-9.6 3z" fill="var(--hue)" />
  </g>
  <path d="M57 31.5L35 51 23 44.5 45 25z" class="roof-side" />
  <path d="M34 53.5L58 32 82 53.5" class="roof" />
  <circle cx="58" cy="62" r="8.6" class="hole" />
  <path d="M50.2 62a7.8 7.8 0 0 1 15.6 0" class="hole-rim" />
  {@render inside?.()}
  <path d="M57 77.5h10.5a2.2 2.2 0 0 1 0 4.4H57z" class="post" />
</g>

<style>
  /* The shared birdhouse is gray (house-* follows the theme); only its flag has the agent's color. */
  .wood {
    fill: var(--house-wood);
  }
  .wood-side {
    fill: var(--house-wood-side);
  }
  .post {
    fill: var(--house-post);
  }
  .hole {
    fill: var(--house-hole);
  }
  .hole-rim {
    fill: none;
    stroke: #000;
    opacity: 0.15;
    stroke-width: 1.6;
  }
  .roof {
    fill: none;
    stroke: var(--house-roof);
    stroke-width: 7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .roof-side {
    fill: var(--house-roof-side);
  }
  .pole {
    stroke: var(--house-roof);
    stroke-width: 1.4;
    stroke-linecap: round;
  }
  .ground {
    fill: #000;
    opacity: 0.08;
  }
  :global([data-theme='dark']) .ground {
    opacity: 0.4;
  }
  .flag {
    transform-origin: 47.5px 27px;
  }

  /*
   * In the avatar, the walls take the agent's color and the side, roof, and post are darker steps
   * of it: lightness lowered, hue and chroma kept (the roof eases its chroma a little). Mixing in
   * black dulled the chroma, so a yellow house turned olive and an orange one brown. The hole is
   * nearly black, tinted with the same hue.
   */
  .tint .wood {
    fill: var(--hue);
  }
  .tint .wood-side {
    fill: oklch(from var(--hue) calc(l * 0.84) c h);
  }
  .tint .roof {
    stroke: oklch(from var(--hue) calc(l * 0.66) calc(c * 0.9) h);
  }
  .tint .roof-side {
    fill: oklch(from var(--hue) calc(l * 0.74) calc(c * 0.95) h);
  }
  .tint .post {
    fill: oklch(from var(--hue) calc(l * 0.78) c h);
  }
  .tint .hole {
    fill: oklch(from var(--hue) 0.26 calc(c * 0.3) h);
  }
  .tint .flag,
  .tint .ground {
    display: none;
  }
</style>
