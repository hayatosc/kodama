<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import MinusIcon from '@lucide/svelte/icons/minus'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import { Button } from '../button/index.js'
  import { ButtonGroup } from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/ButtonGroup',
    component: ButtonGroup,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Related buttons joined into one shape and named as a group (`role="group"` with an `aria-label`). Each button stays its own Tab stop; a set that should be one Tab stop with arrow keys is a toolbar, not a group.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <ButtonGroup aria-label="ファイル操作">
    <Button variant="secondary">アーカイブ</Button>
    <Button variant="secondary">移動</Button>
    <Button variant="secondary">削除</Button>
  </ButtonGroup>
</Story>

<Story name="Split button" asChild>
  <ButtonGroup aria-label="送信">
    <Button>送信</Button>
    <Button size="icon" aria-label="送信のオプション">
      <ChevronDownIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
  </ButtonGroup>
</Story>

<Story name="Vertical" asChild>
  <ButtonGroup orientation="vertical" aria-label="拡大と縮小">
    <Button variant="secondary" size="icon" aria-label="拡大">
      <PlusIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
    <Button variant="secondary" size="icon" aria-label="縮小">
      <MinusIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
  </ButtonGroup>
</Story>
