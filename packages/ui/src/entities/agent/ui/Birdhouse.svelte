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

  /**
   * The shared birdhouse is gray (house-* follows the theme); only its flag has the agent's color.
   * In the avatar, the walls take the agent's color and the side, roof, and post are darker steps
   * of it: lightness lowered, hue and chroma kept (the roof eases its chroma a little). Mixing in
   * black dulled the chroma, so a yellow house turned olive and an orange one brown. The hole is
   * nearly black, tinted with the same hue.
   */
  const wood = $derived(tint ? 'fill-(--hue)' : 'fill-(--house-wood)')
  const woodSide = $derived(
    tint ? 'fill-[oklch(from_var(--hue)_calc(l*0.84)_c_h)]' : 'fill-(--house-wood-side)',
  )
  const roof = $derived(
    tint ? 'stroke-[oklch(from_var(--hue)_calc(l*0.66)_calc(c*0.9)_h)]' : 'stroke-(--house-roof)',
  )
  const roofSide = $derived(
    tint ? 'fill-[oklch(from_var(--hue)_calc(l*0.74)_calc(c*0.95)_h)]' : 'fill-(--house-roof-side)',
  )
  const post = $derived(
    tint ? 'fill-[oklch(from_var(--hue)_calc(l*0.78)_c_h)]' : 'fill-(--house-post)',
  )
  const hole = $derived(
    tint ? 'fill-[oklch(from_var(--hue)_0.26_calc(c*0.3)_h)]' : 'fill-(--house-hole)',
  )
</script>

<!-- Units of viewBox "10 10 100 112": hole center 58,62; perch top at y 77.5. -->
<g style:--hue={`var(--agent-${color})`}>
  <ellipse
    cx="56"
    cy="119.5"
    rx="15"
    ry="2"
    class={['fill-black opacity-[0.08] dark:opacity-40', tint && 'hidden']}
  />
  <rect x="52" y="96" width="9" height="24" rx="3" class={post} />
  <path d="M38 52L26 45v48c0 2 1 3.4 3 4l9 3.6z" class={woodSide} />
  <path
    d="M38 52L58 34 78 52v45.5c0 1.4-1.1 2.5-2.5 2.5h-35c-1.4 0-2.5-1.1-2.5-2.5z"
    class={wood}
  />
  <g class={['origin-[47.5px_27px]', tint && 'hidden']}>
    <path
      d="M47.5 27.2V13.5"
      class="stroke-(--house-roof) [stroke-linecap:round] [stroke-width:1.4]"
    />
    <path d="M47.8 13.6l9.6 2.9-9.6 3z" fill="var(--hue)" />
  </g>
  <path d="M57 31.5L35 51 23 44.5 45 25z" class={roofSide} />
  <path
    d="M34 53.5L58 32 82 53.5"
    class={['fill-none [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:7]', roof]}
  />
  <circle cx="58" cy="62" r="8.6" class={hole} />
  <path
    d="M50.2 62a7.8 7.8 0 0 1 15.6 0"
    class="fill-none stroke-black opacity-15 [stroke-width:1.6]"
  />
  {@render inside?.()}
  <path d="M57 77.5h10.5a2.2 2.2 0 0 1 0 4.4H57z" class={post} />
</g>
