<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up'
  import PaperclipIcon from '@lucide/svelte/icons/paperclip'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SearchIcon from '@lucide/svelte/icons/search'
  import SquareIcon from '@lucide/svelte/icons/square'
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
      size: {
        control: 'inline-radio',
        options: ['default', 'sm', 'icon', 'round', 'circle', 'chip'],
      },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A button that starts an action. Use **primary** for the one main action of a surface (it inverts with the theme), and secondary or ghost for everything else. **destructive** marks archive and delete, which always go through a confirmation dialog. Labels end with a verb. Icon-only buttons need an `aria-label`. Source: `design/components/Button`.',
        },
      },
    },
  })
</script>

<Story name="Primary">新しいエージェント</Story>

<Story name="Secondary" args={{ variant: 'secondary' }}>設定を開く</Story>

<Story name="Ghost" args={{ variant: 'ghost' }}>あとで</Story>

<Story name="Destructive" args={{ variant: 'destructive' }}>アーカイブ</Story>

<Story name="Small" args={{ variant: 'secondary', size: 'sm' }}>ロールバック</Story>

<Story name="Disabled" args={{ disabled: true }}>送信</Story>

<Story
  name="Shapes"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The icon shapes. **icon** and **round** are 36px; **round** is the Composer’s send and stop. **circle** is the 32px outlined button at the top of the sidebar. **chip** blends into the surface, as the Composer’s attach does; it narrows to 32px when it holds only an icon.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-6">
    <Button variant="ghost" size="icon" aria-label="検索"><SearchIcon strokeWidth={1.75} /></Button>
    <Button size="round" aria-label="送信"><ArrowUpIcon strokeWidth={1.75} /></Button>
    <Button size="round" aria-label="停止">
      <SquareIcon class="size-3 fill-current" strokeWidth={1.75} />
    </Button>
    <Button size="circle" aria-label="新しいエージェント"><PlusIcon strokeWidth={1.75} /></Button>
    <Button size="chip"><PaperclipIcon class="size-3.5" strokeWidth={1.75} />添付</Button>
    <Button size="chip" aria-label="添付"
      ><PaperclipIcon class="size-3.5" strokeWidth={1.75} /></Button
    >
  </div>
</Story>

<Story
  name="All variants"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Every variant at both text sizes, then disabled. Disabled is 40% opacity.',
      },
    },
  }}
>
  <div class="grid grid-cols-[auto_repeat(4,auto)] items-center gap-x-4 gap-y-3">
    {#each ['default', 'sm'] as const as size (size)}
      <code class="mono-xs text-muted-foreground">{size}</code>
      <Button {size}>作成</Button>
      <Button {size} variant="secondary">設定を開く</Button>
      <Button {size} variant="ghost">あとで</Button>
      <Button {size} variant="destructive">削除</Button>
    {/each}
    <code class="mono-xs text-muted-foreground">disabled</code>
    <Button disabled>作成</Button>
    <Button disabled variant="secondary">設定を開く</Button>
    <Button disabled variant="ghost">あとで</Button>
    <Button disabled variant="destructive">削除</Button>
  </div>
</Story>
