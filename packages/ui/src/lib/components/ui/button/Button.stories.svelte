<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right'
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SearchIcon from '@lucide/svelte/icons/search'
  import SettingsIcon from '@lucide/svelte/icons/settings'
  import { fn } from 'storybook/test'
  import { Button } from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Button',
    component: Button,
    tags: ['autodocs'],
    args: { variant: 'primary', size: 'default', disabled: false, onclick: fn() },
    argTypes: {
      variant: {
        control: 'inline-radio',
        options: ['primary', 'secondary', 'ghost', 'destructive'],
      },
      size: { control: 'inline-radio', options: ['default', 'sm', 'icon', 'icon-sm'] },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A native `<button>` that starts an action; use a link for navigation. **primary** is the one main action of a surface and inverts with the theme; **secondary** and **ghost** are for everything else; **destructive** marks actions that delete or discard, which an AlertDialog confirms first. Labels end with a verb. Hover changes the fill, a press scales the button down (it dims instead under reduced motion), and keyboard focus draws the outline ring. Source: `design/components/Button`.',
        },
      },
    },
  })
</script>

<Story name="Default">ボタン</Story>

<Story
  name="Variants"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'The four variants. Use one primary per surface.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-3">
    <Button>保存</Button>
    <Button variant="secondary">キャンセル</Button>
    <Button variant="ghost">あとで</Button>
    <Button variant="destructive">削除</Button>
  </div>
</Story>

<Story
  name="Sizes"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '**default** (36px) and **sm** (32px) for text, **icon** and **icon-sm** for a single icon. An icon-only button needs an `aria-label`.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-3">
    <Button variant="secondary">標準</Button>
    <Button variant="secondary" size="sm">小</Button>
    <Button variant="secondary" size="icon" aria-label="設定">
      <SettingsIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
    <Button variant="secondary" size="icon-sm" aria-label="設定">
      <SettingsIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
  </div>
</Story>

<Story
  name="With icon"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'An icon before the label adds meaning; one after it points onward. Icons next to a label are decorative, so they are hidden from screen readers.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-3">
    <Button><PlusIcon strokeWidth={1.75} aria-hidden="true" />新規作成</Button>
    <Button variant="secondary">次へ<ArrowRightIcon strokeWidth={1.75} aria-hidden="true" /></Button
    >
  </div>
</Story>

<Story
  name="Icon only"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Without a visible label, the `aria-label` names the button.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-3">
    <Button variant="ghost" size="icon" aria-label="検索">
      <SearchIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
    <Button variant="secondary" size="icon" aria-label="追加">
      <PlusIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
  </div>
</Story>

<Story
  name="Rounded"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Add `rounded-full` for a pill or a circle, such as a send button.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-3">
    <Button size="icon" class="rounded-full" aria-label="送信">
      <ArrowUpIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
    <Button variant="secondary" class="rounded-full">はじめる</Button>
  </div>
</Story>

<Story name="Disabled" args={{ disabled: true }}>送信</Story>
