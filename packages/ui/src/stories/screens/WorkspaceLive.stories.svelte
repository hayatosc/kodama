<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import WorkspaceLive from './WorkspaceLive.svelte'

  const { Story } = defineMeta({
    title: 'Screens/WorkspaceLive',
    tags: ['autodocs'],
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'The workspace with buttons that fire the events behind each motion, so the birds can be watched end to end. The strip under the buttons streams the real event names (`tool_execution_start`, `kodama.agent-message`, …). Letters fly between birdhouses on an arc, memory cards fly to the memory agent, the scheduler wakes to its alarm, and the main agent peeks over the input while you type. ▶ 通しで見る plays them in order. Under reduced motion the poses switch without motion. Source: `design/components/WorkspaceLive`.',
        },
        story: { inline: false, iframeHeight: 700 },
      },
    },
  })
</script>

<Story name="WorkspaceLive" asChild>
  <WorkspaceLive />
</Story>
