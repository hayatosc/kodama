<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Birdhouse from './Birdhouse.svelte'
  import { WORKING_COLORS, type AgentColor } from '../model/avatar.js'

  const colors: AgentColor[] = [...WORKING_COLORS, 'ink', 'system']

  const { Story } = defineMeta({
    title: 'Kodama/Birdhouse',
    component: Birdhouse,
    tags: ['autodocs'],
    args: { color: 'orange' },
    argTypes: { color: { control: 'select', options: colors } },
    parameters: {
      docs: {
        description: {
          component:
            'The shared birdhouse, drawn large in the workspace, where agents come and go. It is gray in the theme’s house-* colors; only the flag on its roof has the agent’s color. It draws into an SVG in the units of `viewBox="10 10 100 112"`: the hole is centered at 58,62 and the perch top is at y 77.5. Source: `design/components/AgentAvatar`.',
        },
      },
    },
  })
</script>

<Story name="Default">
  {#snippet template(args)}
    <svg viewBox="10 10 100 112" class="h-32 w-28" role="img" aria-label="research の巣箱">
      <Birdhouse {...args} />
    </svg>
  {/snippet}
</Story>
