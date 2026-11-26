<script lang="ts">
  import { Search, Share } from '@lucide/svelte'
  import { ActivityFeed, type ActivityItem } from '#entities/activity/index.js'
  import { AgentAvatar, StatusBadge } from '#entities/agent/index.js'
  import { Badge } from '#shared/ui/badge/index.js'
  import { Button } from '#shared/ui/button/index.js'
  import { Combobox, type ComboboxOption } from '#shared/ui/combobox/index.js'
  import * as DropdownMenu from '#shared/ui/dropdown-menu/index.js'
  import * as InputGroup from '#shared/ui/input-group/index.js'
  import * as SettingsList from '#shared/ui/settings-list/index.js'
  import { Switch } from '#shared/ui/switch/index.js'
  import * as Tabs from '#shared/ui/tabs/index.js'
  import { cn } from '#shared/lib/utils.js'
  import {
    MEMORY_KIND_WORDS,
    filterMemories,
    formatMemoryDate,
    type AgentTool,
    type MemoryItem,
    type ProfileAgent,
    type Routine,
  } from '../model/profile.js'

  let {
    agent,
    routines,
    nextAlarm,
    provider = $bindable(''),
    providers,
    model = $bindable(''),
    models,
    activity,
    memories,
    tools = $bindable([]),
    tab = $bindable('details'),
    onmemoryedit,
    onmemorydelete,
    now = new Date(),
    class: className,
  }: {
    agent: ProfileAgent
    routines: readonly Routine[]
    /** When the next alarm wakes the agent, such as `03:00`. */
    nextAlarm?: string
    provider?: string
    providers: readonly ComboboxOption[]
    model?: string
    models: readonly ComboboxOption[]
    /** Newest first. */
    activity: readonly ActivityItem[]
    memories: readonly MemoryItem[]
    /** Each tool's switch writes back to its `enabled`. */
    tools?: AgentTool[]
    tab?: 'details' | 'memory' | 'tools'
    onmemoryedit?: (id: string) => void
    onmemorydelete?: (id: string) => void
    /** The time activity is written against; mock data passes a fixed one. */
    now?: Date
    class?: string
  } = $props()

  const id = $props.id()

  let query = $state('')
  const shownMemories = $derived(filterMemories(memories, query))
</script>

<!--
  design/components/ProfilePanel: the agent's profile in the right pane, 320px wide. A 72px
  avatar with the name and status badge, then three tabs: 詳細 (routines, settings, and a compact
  activity feed), 記憶 (a search and the remembered items, each opening an edit and delete menu),
  and ツール (each tool with a switch; system-managed tools cannot be turned off). Arrow keys move
  between the tabs. Collapsing below 1280px and the phone's sheet come with the screens.
-->
<aside
  aria-label="エージェントの詳細"
  data-slot="profile-panel"
  class={cn(
    'flex h-full w-80 flex-col gap-4 overflow-y-auto border-s border-border bg-background p-4',
    className,
  )}
>
  <div class="flex justify-end">
    <Button variant="secondary" size="icon-sm" class="rounded-full" aria-label="共有">
      <Share aria-hidden="true" strokeWidth={1.75} />
    </Button>
  </div>

  <div class="flex flex-col items-center gap-2 pt-4">
    <AgentAvatar color={agent.avatar.color} pose={agent.avatar.pose} size={72} />
    <h2 class="font-display text-lg leading-7 font-semibold tracking-[-0.01em]">{agent.slug}</h2>
    <StatusBadge status={agent.status} />
  </div>

  <Tabs.Root bind:value={tab}>
    <Tabs.List aria-label="表示する内容">
      <Tabs.Trigger value="details">詳細</Tabs.Trigger>
      <Tabs.Trigger value="memory">記憶</Tabs.Trigger>
      <Tabs.Trigger value="tools">ツール</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="details" class="gap-4">
      <SettingsList.Root heading="ルーティン">
        {#each routines as routine (routine.id)}
          <SettingsList.Value
            label={routine.name}
            value={routine.schedule}
            class="[&>span:last-child]:text-xs"
          />
        {/each}
        {#if nextAlarm}
          <SettingsList.Value
            label="次のアラーム"
            value={nextAlarm}
            class="[&>span:last-child]:text-xs"
          />
        {/if}
      </SettingsList.Root>
      <SettingsList.Root heading="設定">
        <SettingsList.Row label="プロバイダー">
          <Combobox
            label="プロバイダー"
            options={providers}
            variant="inline"
            bind:value={provider}
          />
        </SettingsList.Row>
        <SettingsList.Row label="モデル">
          <Combobox label="モデル" options={models} variant="inline" mono bind:value={model} />
        </SettingsList.Row>
      </SettingsList.Root>
      <section aria-labelledby={`${id}-activity`} class="flex flex-col gap-2">
        <h3 id={`${id}-activity`} class="px-1 text-xs font-normal text-muted-foreground">
          アクティビティ
        </h3>
        <ActivityFeed items={activity} compact {now} />
      </section>
    </Tabs.Content>

    <Tabs.Content value="memory">
      <InputGroup.Root>
        <InputGroup.Addon><Search strokeWidth={1.75} aria-hidden="true" /></InputGroup.Addon>
        <InputGroup.Input
          bind:value={query}
          type="search"
          placeholder="記憶を検索"
          aria-label="記憶を検索"
        />
      </InputGroup.Root>
      {#if shownMemories.length > 0}
        <ul class="flex flex-col">
          {#each shownMemories as memory (memory.id)}
            <li>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  variant="ghost"
                  class="h-auto w-full flex-col items-stretch gap-0.5 rounded-lg px-2.5 py-2 text-start font-normal whitespace-normal"
                >
                  <span class="flex items-center gap-2 text-xs leading-4 text-muted-foreground">
                    <Badge class="h-4.5 px-1.5 text-xs">{MEMORY_KIND_WORDS[memory.kind]}</Badge>
                    <span
                      >{memory.source} ·
                      <time datetime={memory.at}>{formatMemoryDate(memory.at)}</time></span
                    >
                  </span>
                  <span class="text-sm leading-5 text-foreground">{memory.text}</span>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item onclick={() => onmemoryedit?.(memory.id)}
                    >編集</DropdownMenu.Item
                  >
                  <DropdownMenu.Item
                    class="text-destructive"
                    onclick={() => onmemorydelete?.(memory.id)}>削除</DropdownMenu.Item
                  >
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="px-2.5 py-2 text-sm text-muted-foreground" role="status">
          一致する記憶がありません
        </p>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="tools">
      <ul class="flex flex-col">
        {#each tools as tool (tool.name)}
          <li class="flex items-center gap-3 px-2.5 py-2">
            <span class="min-w-0 flex-1">
              <span
                id={`${id}-${tool.name}`}
                class="block font-mono text-sm leading-5 font-semibold">{tool.name}</span
              >
              <span
                id={`${id}-${tool.name}-description`}
                class="block text-xs text-muted-foreground">{tool.description}</span
              >
            </span>
            <Switch
              bind:checked={tool.enabled}
              disabled={tool.locked}
              aria-labelledby={`${id}-${tool.name}`}
              aria-describedby={`${id}-${tool.name}-description`}
            />
          </li>
        {/each}
      </ul>
    </Tabs.Content>
  </Tabs.Root>
</aside>
