<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis'
  import { Badge } from '../badge/index.js'
  import { Button } from '../button/index.js'
  import CardRoot from './card.svelte'
  import * as Card from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Card',
    component: CardRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'One piece of content in a bordered box, on `<article>`, with **Header** (a **Title**, its **Description**, and an optional **Action**), **Content**, and **Footer** in that order. **Title** takes the heading `level` that fits the page (h3 by default). Links and buttons inside stay separate native controls. The card is a size container, so its parts can adapt to its own width.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Card.Root class="w-80">
    <Card.Content>今週の会話は 128 件です</Card.Content>
  </Card.Root>
</Story>

<Story name="Usage summary" asChild>
  <Card.Root class="w-80">
    <Card.Header>
      <Card.Title>今週の利用状況</Card.Title>
      <Card.Description>11 月 4 日〜11 月 10 日</Card.Description>
    </Card.Header>
    <Card.Content>
      <p class="text-2xl font-semibold tabular-nums">128,400 トークン</p>
      <p class="text-muted-foreground">先週より 12% 少なくなっています</p>
    </Card.Content>
    <Card.Footer>
      <Button variant="secondary" size="sm">詳細を見る</Button>
    </Card.Footer>
  </Card.Root>
</Story>

<Story
  name="With action"
  asChild
  parameters={{
    docs: {
      description: { story: 'An icon button at the end of the header, beside the title.' },
    },
  }}
>
  <Card.Root class="w-80">
    <Card.Header>
      <Card.Title>朝の要約</Card.Title>
      <Card.Description>毎日 7:00 に実行</Card.Description>
      <Card.Action>
        <Button variant="ghost" size="icon-sm" aria-label="朝の要約の操作">
          <EllipsisIcon strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="flex items-center gap-2">
      <Badge variant="live">有効</Badge>
      <span class="text-muted-foreground">次回は明日 7:00</span>
    </Card.Content>
  </Card.Root>
</Story>
