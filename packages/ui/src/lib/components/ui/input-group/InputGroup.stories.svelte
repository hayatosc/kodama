<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'
  import * as Field from '../field/index.js'
  import * as KeyboardKey from '../keyboard-key/index.js'
  import * as InputGroup from './index.js'
  import InputGroupRoot from './input-group.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/InputGroup',
    component: InputGroupRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'An input with icons, fixed text, or buttons inside one border. The group draws the focus ring while its input has keyboard focus, and the destructive border while it is invalid. **Addon** goes before (`inline-start`) or after (`inline-end`) the input; **Button** is an icon button that needs an `aria-label`; **Text** is a unit or a prefix. Wrap a search in a `<search>` element.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let query = $state('記憶の整理')
</script>

<Story
  name="Search"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A search field with a magnifier and a clear button. The icon is decorative; the field is named by its label.',
      },
    },
  }}
>
  <search class="w-72">
    <Field.Root>
      <Field.Label class="sr-only">会話を検索</Field.Label>
      <InputGroup.Root>
        <InputGroup.Addon><SearchIcon strokeWidth={1.75} aria-hidden="true" /></InputGroup.Addon>
        <InputGroup.Input
          type="search"
          name="q"
          placeholder="会話を検索"
          autocapitalize="none"
          spellcheck="false"
          bind:value={query}
        />
        {#if query}
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button aria-label="検索語を消す" onclick={() => (query = '')}>
              <XIcon strokeWidth={1.75} aria-hidden="true" />
            </InputGroup.Button>
          </InputGroup.Addon>
        {/if}
      </InputGroup.Root>
    </Field.Root>
  </search>
</Story>

<Story
  name="With text"
  asChild
  parameters={{
    docs: { description: { story: 'A fixed prefix and a unit, outside the value itself.' } },
  }}
>
  <Field.Group class="w-72">
    <Field.Root>
      <Field.Label>Webhook の URL</Field.Label>
      <InputGroup.Root>
        <InputGroup.Addon><InputGroup.Text>https://</InputGroup.Text></InputGroup.Addon>
        <InputGroup.Input name="webhook" autocapitalize="none" spellcheck="false" />
      </InputGroup.Root>
    </Field.Root>
    <Field.Root>
      <Field.Label>上限</Field.Label>
      <InputGroup.Root>
        <InputGroup.Input name="limit" inputmode="numeric" value="1000" />
        <InputGroup.Addon align="inline-end"
          ><InputGroup.Text>トークン</InputGroup.Text></InputGroup.Addon
        >
      </InputGroup.Root>
    </Field.Root>
  </Field.Group>
</Story>

<Story
  name="With keys"
  asChild
  parameters={{
    docs: { description: { story: 'A key hint at the end, for a field with a shortcut.' } },
  }}
>
  <Field.Root class="w-72">
    <Field.Label class="sr-only">コマンドを検索</Field.Label>
    <InputGroup.Root>
      <InputGroup.Addon><SearchIcon strokeWidth={1.75} aria-hidden="true" /></InputGroup.Addon>
      <InputGroup.Input type="search" name="command" placeholder="コマンドを検索" />
      <InputGroup.Addon align="inline-end" class="pe-3">
        <KeyboardKey.Group
          ><KeyboardKey.Root>⌘</KeyboardKey.Root><KeyboardKey.Root>K</KeyboardKey.Root
          ></KeyboardKey.Group
        >
      </InputGroup.Addon>
    </InputGroup.Root>
  </Field.Root>
</Story>
