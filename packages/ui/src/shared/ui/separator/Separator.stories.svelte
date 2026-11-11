<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Separator from './separator.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Separator',
    component: Separator,
    tags: ['autodocs'],
    args: { orientation: 'horizontal', decorative: true },
    argTypes: {
      orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
      decorative: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A 1px line in the border color. By default it is decorative and hidden from assistive technology; set `decorative={false}` when it separates sections, and a horizontal one becomes a native `<hr>`.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <div class="flex w-72 flex-col gap-3 text-sm">
    <p>アカウント</p>
    <Separator />
    <p>通知</p>
  </div>
</Story>

<Story name="Vertical" asChild>
  <div class="flex h-5 items-center gap-3 text-sm">
    <span>ヘルプ</span>
    <Separator orientation="vertical" />
    <span>利用規約</span>
    <Separator orientation="vertical" />
    <span>プライバシー</span>
  </div>
</Story>
