<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Badge } from '../badge/index.js'
  import * as Table from './index.js'
  import TableRoot from './Table.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Table',
    component: TableRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Rows and columns of data on the native table elements, so screen readers can move by row and column and hear each cell’s header. **Root** wraps the table in a named scroll area: it scrolls sideways when the table is wider than its column, and becomes a Tab stop only then, so a keyboard can scroll it too. The header row stays on top. Give the table a **Caption**; **Head** cells head columns (`scope="col"`) or rows (`scope="row"`).',
        },
      },
    },
  })

  const usage = [
    { agent: 'assistant', model: 'claude-sonnet-5-5', runs: 412, tokens: 1_284_000, state: 'live' },
    { agent: 'research', model: 'claude-opus-5-5', runs: 96, tokens: 2_045_500, state: 'running' },
    {
      agent: 'scheduler',
      model: 'claude-haiku-5-5',
      runs: 1_830,
      tokens: 402_300,
      state: 'neutral',
    },
  ] as const

  const format = new Intl.NumberFormat('ja-JP')

  const sample = [
    { name: 'assistant', value: 412 },
    { name: 'research', value: 96 },
    { name: 'scheduler', value: 1_830 },
  ]
</script>

<Story name="Default" asChild>
  <div class="w-80">
    <Table.Root label="エージェントごとの実行回数">
      <Table.Header>
        <Table.Row>
          <Table.Head>エージェント</Table.Head>
          <Table.Head class="text-end">実行</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each sample as row (row.name)}
          <Table.Row>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell class="text-end tabular-nums">{format.format(row.value)}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</Story>

<Story name="Usage" asChild>
  <div class="w-[560px]">
    <Table.Root label="エージェントごとの利用状況">
      <Table.Caption>11 月 1 日〜11 月 10 日の利用状況</Table.Caption>
      <Table.Header>
        <Table.Row>
          <Table.Head>エージェント</Table.Head>
          <Table.Head>モデル</Table.Head>
          <Table.Head class="text-end">実行</Table.Head>
          <Table.Head class="text-end">トークン</Table.Head>
          <Table.Head>状態</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each usage as row (row.agent)}
          <Table.Row>
            <Table.Head scope="row">{row.agent}</Table.Head>
            <Table.Cell class="font-mono text-xs">{row.model}</Table.Cell>
            <Table.Cell class="text-end tabular-nums">{format.format(row.runs)}</Table.Cell>
            <Table.Cell class="text-end tabular-nums">{format.format(row.tokens)}</Table.Cell>
            <Table.Cell>
              <Badge variant={row.state}>
                {row.state === 'live' ? '稼働中' : row.state === 'running' ? '実行中' : '待機中'}
              </Badge>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
      <Table.Footer>
        <Table.Row>
          <Table.Head scope="row" colspan={2}>合計</Table.Head>
          <Table.Cell class="text-end tabular-nums">
            {format.format(usage.reduce((sum, row) => sum + row.runs, 0))}
          </Table.Cell>
          <Table.Cell class="text-end tabular-nums">
            {format.format(usage.reduce((sum, row) => sum + row.tokens, 0))}
          </Table.Cell>
          <Table.Cell></Table.Cell>
        </Table.Row>
      </Table.Footer>
    </Table.Root>
  </div>
</Story>

<Story
  name="Narrow column"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The same table in a 280px column: the area scrolls sideways, and Tab reaches it so the arrow keys can scroll it.',
      },
    },
  }}
>
  <div class="w-[280px]">
    <Table.Root label="エージェントごとの利用状況（狭い列）">
      <Table.Caption>利用状況</Table.Caption>
      <Table.Header>
        <Table.Row>
          <Table.Head>エージェント</Table.Head>
          <Table.Head>モデル</Table.Head>
          <Table.Head class="text-end">トークン</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each usage as row (row.agent)}
          <Table.Row>
            <Table.Head scope="row">{row.agent}</Table.Head>
            <Table.Cell class="font-mono text-xs whitespace-nowrap">{row.model}</Table.Cell>
            <Table.Cell class="text-end tabular-nums">{format.format(row.tokens)}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</Story>
