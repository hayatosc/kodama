<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search'
  import ShareIcon from '@lucide/svelte/icons/share'
  import Select from '../Select.svelte'
  import StatusBadge from '../StatusBadge.svelte'
  import { AgentAvatar, type AgentColor, type AgentPose } from '../avatar/index.js'
  import type { ActivityItem, AgentTool, MemoryItem, RunState, SelectOption } from '../types.js'
  import { Badge } from '../ui/badge/index.js'
  import { Button } from '../ui/button/index.js'
  import { Switch } from '../ui/switch/index.js'
  import * as Tabs from '../ui/tabs/index.js'
  import { cn } from '#lib/utils.js'
  import ActivityFeed from './ActivityFeed.svelte'
  import SettingsList from './SettingsList.svelte'
  import SettingsRow from './SettingsRow.svelte'

  let {
    agent,
    routines,
    nextAlarm,
    provider = $bindable(),
    providers,
    model = $bindable(),
    models,
    activity,
    memories,
    tools = $bindable(),
    tab = $bindable('details'),
    now = new Date(),
    onshare,
    class: className,
  }: {
    agent: { slug: string; status: RunState; avatar: { color: AgentColor; pose: AgentPose } }
    /** Cron routines: a name and a schedule such as 09:00 毎日. */
    routines: { name: string; schedule: string }[]
    /** When the next alarm fires, such as 03:00. */
    nextAlarm?: string
    provider?: string
    providers: SelectOption[]
    model?: string
    models: SelectOption[]
    activity: ActivityItem[]
    memories: MemoryItem[]
    tools: AgentTool[]
    tab?: 'details' | 'memory' | 'tools'
    now?: Date
    onshare?: () => void
    class?: string
  } = $props()

  let query = $state('')

  const shownMemories = $derived(
    query.trim() === ''
      ? memories
      : memories.filter((memory) => `${memory.text} ${memory.source}`.includes(query.trim())),
  )

  function shortDate(at: string): string {
    const date = new Date(at)
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
</script>

<aside
  class={cn(
    'flex w-[320px] flex-col gap-4 border-l border-border bg-background p-4 [--badge-ring:var(--background)]',
    className,
  )}
  aria-label="エージェントの詳細"
>
  <div class="flex justify-end">
    <Button size="circle" aria-label="共有" onclick={onshare}
      ><ShareIcon strokeWidth={1.75} /></Button
    >
  </div>
  <div class="flex flex-col items-center gap-2 pt-4">
    <AgentAvatar color={agent.avatar.color} pose={agent.avatar.pose} size={72} />
    <h2 class="type-lg">{agent.slug}</h2>
    <StatusBadge status={agent.status} />
  </div>

  <Tabs.Root bind:value={tab}>
    <Tabs.List aria-label="エージェントの情報">
      <Tabs.Trigger value="details">詳細</Tabs.Trigger>
      <Tabs.Trigger value="memory">記憶</Tabs.Trigger>
      <Tabs.Trigger value="tools">ツール</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="details" class="gap-4">
      <SettingsList title="ルーティン">
        {#each routines as routine (routine.name)}
          <SettingsRow label={routine.name} value={routine.schedule} />
        {/each}
        {#if nextAlarm}
          <SettingsRow label="次のアラーム" value={nextAlarm} />
        {/if}
      </SettingsList>
      <SettingsList title="設定">
        <SettingsRow label="プロバイダー">
          <Select options={providers} bind:value={provider} variant="inline" label="プロバイダー" />
        </SettingsRow>
        <SettingsRow label="モデル">
          <Select options={models} bind:value={model} variant="inline" mono label="モデル" />
        </SettingsRow>
      </SettingsList>
      <section class="flex flex-col gap-2" aria-label="アクティビティ">
        <h3 class="px-1 text-xs text-muted-foreground">アクティビティ</h3>
        <ActivityFeed items={activity} compact {now} />
      </section>
    </Tabs.Content>

    <Tabs.Content value="memory">
      <label
        class="flex h-9 items-center gap-2 rounded-lg border border-input px-2.5 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
      >
        <SearchIcon class="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <input
          bind:value={query}
          type="search"
          placeholder="記憶を検索"
          aria-label="記憶を検索"
          class="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <ul class="flex flex-col">
        {#each shownMemories as memory (memory.text)}
          <li class="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 hover:bg-accent">
            <span class="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge class="h-[18px] px-1.5 text-[11px]">{memory.kind}</Badge>
              <span>{memory.source} · {shortDate(memory.at)}</span>
            </span>
            <span class="text-sm">{memory.text}</span>
          </li>
        {:else}
          <li class="px-2.5 py-2 text-sm text-muted-foreground">一致する記憶がありません</li>
        {/each}
      </ul>
    </Tabs.Content>

    <Tabs.Content value="tools">
      <ul class="flex flex-col">
        {#each tools as tool (tool.name)}
          <li class="flex items-center gap-3 px-2.5 py-2">
            <label for={`tool-${tool.name}`} class="min-w-0 flex-1">
              <b class="block font-mono text-sm font-semibold">{tool.name}</b>
              <small class="block text-xs text-muted-foreground">{tool.description}</small>
            </label>
            <Switch id={`tool-${tool.name}`} bind:checked={tool.enabled} disabled={tool.locked} />
          </li>
        {/each}
      </ul>
    </Tabs.Content>
  </Tabs.Root>
</aside>
