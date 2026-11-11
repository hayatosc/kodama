<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import BadgeCheckIcon from '@lucide/svelte/icons/badge-check'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import { Badge } from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Badge',
    component: Badge,
    tags: ['autodocs'],
    args: { variant: 'neutral' },
    argTypes: {
      variant: {
        control: 'inline-radio',
        options: ['neutral', 'outline', 'live', 'running', 'destructive'],
      },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A short, non-interactive label: a state, a category, or a count. Only **live**, **running**, and **destructive** have a color; keep the rest neutral, because most states should be quiet. Color never carries the meaning alone: the word does, and an icon or a dot can add a shape. Source: `design/components/StatusBadge`.',
        },
      },
    },
  })
</script>

<Story name="Default">下書き</Story>

<Story
  name="Variants"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '**neutral** and **outline** for most labels, **live** for something active now, **running** for work in progress, **destructive** for a failure.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-2">
    <Badge>下書き</Badge>
    <Badge variant="outline">ベータ</Badge>
    <Badge variant="live">公開中</Badge>
    <Badge variant="running">処理中</Badge>
    <Badge variant="destructive">エラー</Badge>
  </div>
</Story>

<Story
  name="With icon"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'A 12px icon before the word. The icon repeats the word, so it is hidden.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-2">
    <Badge variant="outline"><BadgeCheckIcon strokeWidth={2} aria-hidden="true" />確認済み</Badge>
    <Badge variant="destructive">
      <TriangleAlertIcon strokeWidth={2} aria-hidden="true" />期限切れ
    </Badge>
  </div>
</Story>

<Story
  name="With dot"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A status dot before the word. Each dot has its own shape (filled, hollow circle, hollow square), so the states differ without color. A dot for work in progress may blink with `motion-safe:animate-blink`: three times (4.8s, under the five-second limit for blinking without a pause control), and not at all under reduced motion. It is left still here, because Storybook waits for finite animations before applying the theme.',
      },
    },
  }}
>
  <div class="flex flex-wrap items-center gap-2">
    <Badge variant="live">
      <span aria-hidden="true" class="size-2 rounded-full bg-live"></span>稼働中
    </Badge>
    <Badge variant="running">
      <span aria-hidden="true" class="size-2 rounded-full bg-running"></span>実行中
    </Badge>
    <Badge>
      <span
        aria-hidden="true"
        class="size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]"
      ></span>待機中
    </Badge>
    <Badge>
      <span
        aria-hidden="true"
        class="size-2 rounded-[2px] shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]"
      ></span>一時停止
    </Badge>
  </div>
</Story>
