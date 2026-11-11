<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Field from '../field/index.js'
  import Input from './input.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Input',
    component: Input,
    tags: ['autodocs'],
    args: { placeholder: '', disabled: false },
    argTypes: {
      type: {
        control: 'select',
        options: ['text', 'email', 'password', 'search', 'tel', 'url', 'number'],
      },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A native text input. Give it a visible label (inside a **Field**, the label, description, and error link to it on their own) and the type, `autocomplete`, and `inputmode` that match the data. The text is 16px, so iOS does not zoom on focus, and touch screens get a 48px field. The border turns destructive only after the user has interacted with an invalid value (`:user-invalid`), and `aria-invalid` follows it. Placeholders are hints, never the label.',
        },
      },
    },
  })
</script>

<Story name="Default">
  {#snippet template(args)}
    <Field.Root class="w-72">
      <Field.Label>表示名</Field.Label>
      <Input {...args} name="display-name" autocomplete="nickname" />
    </Field.Root>
  {/snippet}
</Story>

<Story
  name="Types"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Each type brings its own keyboard and checks: `email` and `url` validate the format, `search` adds a clear button on some systems, and `password` hides the text. Fields for identifiers turn off autocorrect.',
      },
    },
  }}
>
  <Field.Group class="w-72">
    <Field.Root>
      <Field.Label>メールアドレス</Field.Label>
      <Input
        type="email"
        name="email"
        autocomplete="email"
        autocapitalize="none"
        spellcheck="false"
      />
    </Field.Root>
    <Field.Root>
      <Field.Label>パスワード</Field.Label>
      <Input type="password" name="password" autocomplete="current-password" />
    </Field.Root>
    <Field.Root>
      <Field.Label>Web サイト</Field.Label>
      <Input type="url" name="website" autocomplete="url" placeholder="https://example.com" />
    </Field.Root>
  </Field.Group>
</Story>

<Story
  name="With description"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Format rules go in a Field.Description, which stays visible and is read after the label, instead of in the placeholder.',
      },
    },
  }}
>
  <Field.Root class="w-72">
    <Field.Label>ユーザー名</Field.Label>
    <Input
      name="username"
      autocomplete="username"
      autocapitalize="none"
      spellcheck="false"
      minlength={3}
      maxlength={20}
      required
    />
    <Field.Description>3〜20 文字の英数字とハイフン。</Field.Description>
  </Field.Root>
</Story>

<Story
  name="Required"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A required field stays neutral until the user leaves it empty or invalid; then the border turns destructive and `aria-invalid` becomes true. Type an address and move away to see it.',
      },
    },
  }}
>
  <Field.Root class="w-72">
    <Field.Label>連絡先メールアドレス <span aria-hidden="true">*</span></Field.Label>
    <Input type="email" name="contact" autocomplete="email" required />
  </Field.Root>
</Story>

<Story name="Disabled" args={{ disabled: true, value: 'assistant' }}>
  {#snippet template(args)}
    <Field.Root class="w-72">
      <Field.Label>識別子</Field.Label>
      <Input {...args} name="slug" />
      <Field.Description>作成後は変更できません。</Field.Description>
    </Field.Root>
  {/snippet}
</Story>
