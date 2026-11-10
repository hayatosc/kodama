<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Composer from '../../lib/components/conversation/Composer.svelte'
  import ConversationPane from '../../lib/components/conversation/ConversationPane.svelte'
  import AgentSidebar from '../../lib/components/panel/AgentSidebar.svelte'
  import ProfilePanel from '../../lib/components/panel/ProfilePanel.svelte'
  import BottomSheet from '../../lib/components/screens/BottomSheet.svelte'
  import MobileAppBar from '../../lib/components/screens/MobileAppBar.svelte'
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
    title: 'Screens/Mobile',
    tags: ['autodocs'],
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'The phone layout (below 1024px): one pane at a time. The list matches the sidebar under a Kodama heading; tapping a row opens the conversation under a 56px app bar; the details button opens the profile as a sheet from the bottom. Phones have no Tab key, so the Composer’s sheet shows キューに追加 (add to queue) while typing during a run. Source: `design/components/Mobile`.',
        },
        story: { inline: false, iframeHeight: 812 },
      },
    },
  })
</script>

<script lang="ts">
  let view = $state<'list' | 'chat'>('list')
  let sheet = $state(false)
  let running = $state(true)
  let queue = $state(['出典の URL も添えて'])
  let draft = $state('表も入れて')
  let provider = $state('anthropic')
  let model = $state('claude-sonnet-5-5')
  let agentTools = $state(tools.map((tool) => ({ ...tool })))
</script>

{#snippet chat()}
  <div class="flex h-full flex-col">
    <MobileAppBar
      agent={{
        slug: mainAgent.slug,
        avatar: mainAgent.avatar,
        status: mainAgent.status,
        activity: mainAgent.latest,
      }}
      onback={() => (view = 'list')}
      ondetails={() => (sheet = true)}
    />
    <ConversationPane mobile class="min-h-0 flex-1">
      <Transcript mobile />
      {#snippet composer()}
        <Composer
          agentName="assistant"
          mobile
          {running}
          {queue}
          bind:value={draft}
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
    <BottomSheet bind:open={sheet} label="エージェントの詳細">
      <ProfilePanel
        sheet
        onclose={() => (sheet = false)}
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
        now={NOW}
      />
    </BottomSheet>
  </div>
{/snippet}

<Story
  name="Try it"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Tap the main agent to open the conversation, the back button to return, and the details button for the sheet.',
      },
    },
  }}
>
  <div class="mx-auto h-[812px] w-full max-w-[375px] overflow-hidden border-x border-border">
    {#if view === 'list'}
      <AgentSidebar
        mobile
        main={mainAgent}
        agents={workingAgents}
        system={systemAgents}
        user={{ name: 'hayatosc' }}
        now={NOW}
        onselect={() => (view = 'chat')}
      />
    {:else}
      {@render chat()}
    {/if}
  </div>
</Story>

<Story name="Conversation" asChild>
  <div class="mx-auto h-[812px] w-full max-w-[375px] overflow-hidden border-x border-border">
    {@render chat()}
  </div>
</Story>
