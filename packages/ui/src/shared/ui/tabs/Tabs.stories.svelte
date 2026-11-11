<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import LockIcon from '@lucide/svelte/icons/lock'
  import UserIcon from '@lucide/svelte/icons/user'
  import * as Tabs from './index.js'
  import TabsRoot from './tabs.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Tabs',
    component: TabsRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Panels of related content, one shown at a time, built on bits-ui Tabs. Arrow keys move between tabs and selection follows focus, and Tab moves into the panel. The selected tab sits on muted with a border, so it is not marked by color alone and stays visible in forced colors mode. Use links, not tabs, for page navigation. Source: `design/components/Tabs`.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Tabs.Root value="account" class="w-80">
    <Tabs.List aria-label="アカウントの設定">
      <Tabs.Trigger value="account">アカウント</Tabs.Trigger>
      <Tabs.Trigger value="password">パスワード</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="account">
      <p class="text-sm text-muted-foreground">名前とメールアドレスを変更できます</p>
    </Tabs.Content>
    <Tabs.Content value="password">
      <p class="text-sm text-muted-foreground">
        パスワードを変更すると、ほかの端末からログアウトします。
      </p>
    </Tabs.Content>
  </Tabs.Root>
</Story>

<Story
  name="Disabled"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'A disabled tab stays in the list at 40% opacity, and arrow keys skip it.',
      },
    },
  }}
>
  <Tabs.Root value="overview" class="w-80">
    <Tabs.List aria-label="プロジェクト">
      <Tabs.Trigger value="overview">概要</Tabs.Trigger>
      <Tabs.Trigger value="reports" disabled>レポート</Tabs.Trigger>
      <Tabs.Trigger value="settings">設定</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="overview">
      <p class="text-sm text-muted-foreground">直近のアクティビティと進み具合です</p>
    </Tabs.Content>
    <Tabs.Content value="reports">
      <p class="text-sm text-muted-foreground">レポートは準備中です</p>
    </Tabs.Content>
    <Tabs.Content value="settings">
      <p class="text-sm text-muted-foreground">プロジェクトの名前と公開範囲です</p>
    </Tabs.Content>
  </Tabs.Root>
</Story>

<Story
  name="With icons"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'A 16px icon before each label. The label names the tab, so the icon is hidden.',
      },
    },
  }}
>
  <Tabs.Root value="profile" class="w-80">
    <Tabs.List aria-label="設定">
      <Tabs.Trigger value="profile">
        <UserIcon strokeWidth={1.75} aria-hidden="true" />プロフィール
      </Tabs.Trigger>
      <Tabs.Trigger value="security">
        <LockIcon strokeWidth={1.75} aria-hidden="true" />セキュリティ
      </Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="profile">
      <p class="text-sm text-muted-foreground">表示名とアイコンです</p>
    </Tabs.Content>
    <Tabs.Content value="security">
      <p class="text-sm text-muted-foreground">パスワードと二段階認証です</p>
    </Tabs.Content>
  </Tabs.Root>
</Story>
