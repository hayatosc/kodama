<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import { NOW, mainAgent, systemAgents, workingAgents } from '../../../stories/mock.js'
  import AgentSidebar from './AgentSidebar.svelte'

  const { Story } = defineMeta({
    title: 'Kodama/AgentSidebar',
    component: AgentSidebar,
    tags: ['autodocs'],
    args: {
      main: mainAgent,
      agents: workingAgents,
      system: systemAgents,
      currentSlug: 'assistant',
      user: { name: 'hayatosc' },
      now: NOW,
      onselect: fn(),
      onsearch: fn(),
      oncreate: fn(),
      onsettings: fn(),
    },
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'The agent list in the left pane. The main agent sits at the top with a large avatar and what it is doing now. Other agents follow, running ones first, then the most recent, each with its face, its latest event, and an unread count or a relative time. Dedicated agents sit under システム (System) in gray with mono names. Source: `design/components/Sidebar`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let current = $state('research')
</script>

<Story name="Main selected" asChild>
  <div class="h-[720px]">
    <AgentSidebar
      main={mainAgent}
      agents={workingAgents}
      system={systemAgents}
      currentSlug="assistant"
      user={{ name: 'hayatosc' }}
      now={NOW}
    />
  </div>
</Story>

<Story
  name="Try it"
  asChild
  parameters={{ docs: { description: { story: 'Click a row to select it.' } } }}
>
  <div class="h-[720px]">
    <AgentSidebar
      main={mainAgent}
      agents={workingAgents}
      system={systemAgents}
      currentSlug={current}
      user={{ name: 'hayatosc' }}
      now={NOW}
      onselect={(slug) => (current = slug)}
    />
  </div>
</Story>
