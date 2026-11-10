<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Composer from '../../lib/components/conversation/Composer.svelte'
  import ConversationPane from '../../lib/components/conversation/ConversationPane.svelte'
  import AgentSidebar from '../../lib/components/panel/AgentSidebar.svelte'
  import ProfilePanel from '../../lib/components/panel/ProfilePanel.svelte'
  import Workspace from '../../lib/components/screens/Workspace.svelte'
  import {
    NOW,
    activity,
    mainAgent,
    memories,
    models,
    providers,
    systemAgents,
    tools,
    workingAgents,
  } from '../mock.js'
  import Transcript from './Transcript.svelte'

  const { Story } = defineMeta({
    title: 'Screens/Workspace',
    tags: ['autodocs'],
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'The whole desktop screen: the agent list, the conversation, and the profile panel in columns of 280px, the rest, and 320px. The center has no header bar; the selected row and the right pane say who you are talking to. The Composer floats at the bottom and the conversation scrolls beneath it. Below 1280px the right pane folds away behind the details button at the top right of the conversation. Source: `design/components/Workspace`.',
        },
        story: { inline: false, iframeHeight: 760 },
      },
    },
  })
</script>

<script lang="ts">
  let current = $state('assistant')
  let running = $state(true)
  let queue = $state(['出典の URL も添えて', '最後に 3 行で要約して'])
  let tab = $state<'details' | 'memory' | 'tools'>('details')
  let provider = $state('anthropic')
  let model = $state('claude-sonnet-5-5')
  let agentTools = $state(tools.map((tool) => ({ ...tool })))
</script>

<Story name="Workspace" asChild>
  <Workspace>
    {#snippet sidebar()}
      <AgentSidebar
        main={mainAgent}
        agents={workingAgents}
        system={systemAgents}
        currentSlug={current}
        user={{ name: 'hayatosc' }}
        now={NOW}
        onselect={(slug) => (current = slug)}
      />
    {/snippet}
    {#snippet panel()}
      <ProfilePanel
        agent={{ slug: mainAgent.slug, status: mainAgent.status, avatar: mainAgent.avatar }}
        routines={[{ name: '毎朝のまとめ', schedule: '09:00 毎日' }]}
        nextAlarm="03:00"
        bind:provider
        {providers}
        bind:model
        {models}
        {activity}
        {memories}
        bind:tools={agentTools}
        bind:tab
        now={NOW}
        class="min-h-full"
      />
    {/snippet}
    <ConversationPane>
      <Transcript />
      {#snippet composer()}
        <Composer
          agentName="assistant"
          {running}
          {queue}
          onsend={() => {}}
          onqueue={(text) => (queue = [...queue, text])}
          onremove={(index) => (queue = queue.filter((_, i) => i !== index))}
          oncancel={() => {
            running = false
            queue = []
          }}
        />
      {/snippet}
    </ConversationPane>
  </Workspace>
</Story>
