<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import AgentAvatar from './AgentAvatar.svelte'
  import Birdhouse from './Birdhouse.svelte'
  import { POSES, WORKING_COLORS, type AgentColor, type AgentPose } from './avatar.js'

  const colors: AgentColor[] = [...WORKING_COLORS, 'ink', 'system']

  /** What makes each pose appear (design/components/AgentAvatar — the table of events). */
  const poseEvents: Record<AgentPose, string> = {
    idle: 'Idle: breathes, blinks, sways its tail',
    listen: 'The user is typing: leans toward the input',
    work: 'tool_execution_start: looks through the lens',
    write: 'message_update: writes with the pen',
    happy: 'A tool or submission finished: jumps once',
    live: 'A reply arrived: waves, with the blue badge',
    tilt: 'A submission is unanswered: tilts, with ?',
    surprised: 'Cancelled: wide eyes and a hop, with !',
    stretch: 'An alarm fired or the agent resumed',
    worried: 'No credentials: fidgets, with the red badge',
    error: 'Failed: × eyes, with the red badge',
    sleep: 'Waiting for an alarm: its birdhouse, with z',
    paused: 'Lifecycle paused: a gray birdhouse, still',
  }

  /** Marks the design pairs with poses. */
  const poseMarks: Partial<Record<AgentPose, string>> = { tilt: '?', surprised: '!' }

  const { Story } = defineMeta({
    title: 'Kodama/AgentAvatar',
    component: AgentAvatar,
    tags: ['autodocs'],
    args: { color: 'violet', pose: 'idle', size: 72, badge: true, label: 'research' },
    argTypes: {
      color: { control: 'select', options: colors },
      pose: { control: 'select', options: POSES },
      prop: { control: 'select', options: [undefined, null, 'lens', 'pen', 'letter'] },
      mark: { control: 'inline-radio', options: [undefined, '?', '!'] },
      size: { control: 'inline-radio', options: [20, 32, 36, 40, 56, 72] },
      badge: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'The agent’s face: a small bird in a circle tinted with its color. Color says who; pose and motion say what it is doing now, and each motion matches a real event. While it waits for an alarm or is paused, the circle shows its birdhouse instead. The avatar looks exactly the same in light and dark. Under reduced motion it holds still and the pose alone carries the state. Source: `design/components/AgentAvatar`.',
        },
      },
    },
  })
</script>

<Story name="Playground" />

<Story
  name="Poses"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Every pose at 56px with the event that brings it on. `work` and `write` hold their prop by default, so they show no badge.',
      },
    },
  }}
>
  <ul class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-6 gap-y-5">
    {#each POSES as pose (pose)}
      <li class="flex items-center gap-3">
        <AgentAvatar
          color="violet"
          {pose}
          mark={poseMarks[pose]}
          size={56}
          label={`research: ${pose}`}
        />
        <span class="flex flex-col">
          <code class="mono-xs">{pose}</code>
          <span class="text-xs text-muted-foreground">{poseEvents[pose]}</span>
        </span>
      </li>
    {/each}
    <li class="flex items-center gap-3">
      <AgentAvatar color="violet" prop="letter" size={56} label="research: idle with a letter" />
      <span class="flex flex-col">
        <code class="mono-xs">idle + letter</code>
        <span class="text-xs text-muted-foreground">contact_agent: holds a letter to deliver</span>
      </span>
    </li>
  </ul>
</Story>

<Story
  name="Colors"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The 11 working colors follow the hue circle. `ink` is reserved for the main agent and `system` for dedicated agents.',
      },
    },
  }}
>
  <ul class="flex flex-wrap gap-4">
    {#each colors as color (color)}
      <li class="flex w-16 flex-col items-center gap-1.5">
        <AgentAvatar {color} size={56} label={color} />
        <code class="mono-xs text-muted-foreground">{color}</code>
      </li>
    {/each}
  </ul>
</Story>

<Story
  name="Sizes"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '72px for the profile panel, 56px for the main agent’s card, 36px for list rows, and 20px inline. At 28px and below the fine lines drop out; at 20px the prop, mark, and badge drop out too, so the face alone carries the pose.',
      },
    },
  }}
>
  <table class="border-separate border-spacing-x-5 border-spacing-y-3">
    <tbody>
      {#each ['idle', 'write', 'live', 'tilt', 'sleep'] as const as pose (pose)}
        <tr>
          <td><code class="mono-xs">{pose}</code></td>
          {#each [72, 56, 36, 20] as const as size (size)}
            <td class="align-middle">
              <AgentAvatar
                color="teal"
                {pose}
                mark={poseMarks[pose]}
                {size}
                label={`${pose} at ${size}px`}
              />
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</Story>

<Story
  name="Birdhouse"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The shared birdhouse, drawn large in the workspace. It is gray in the theme’s house-* colors; only the flag on its roof has the agent’s color.',
      },
    },
  }}
>
  <div class="flex gap-6">
    {#each ['orange', 'sky', 'plum'] as const as color (color)}
      <svg viewBox="10 10 100 112" class="h-32 w-28" role="img" aria-label={`${color} birdhouse`}>
        <Birdhouse {color} />
      </svg>
    {/each}
  </div>
</Story>
