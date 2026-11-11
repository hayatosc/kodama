<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import AvatarRoot from './avatar.svelte'
  import * as Avatar from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Avatar',
    component: AvatarRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A person’s picture in a circle, with their initials until it loads or if it fails (see the Fallback story). The **Image**’s `alt` names the avatar the whole time (it is only transparent until loaded); use `alt=""` when the name is already next to it. Without an Image, the **Fallback** text is read. Agents get their own bird avatar in a later stage.',
        },
      },
    },
  })

  /** A small picture made in place, so the story loads nothing from the network. */
  const picture =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23f97316'/%3E%3Ccircle cx='16' cy='13' r='6' fill='%23fff7ed'/%3E%3Cpath d='M5 30c2-7 7-9 11-9s9 2 11 9' fill='%23fff7ed'/%3E%3C/svg%3E"
</script>

<Story name="Default" asChild>
  <Avatar.Root>
    <Avatar.Image src={picture} alt="田中 葉月" />
    <Avatar.Fallback>田</Avatar.Fallback>
  </Avatar.Root>
</Story>

<Story name="Fallback" asChild>
  <div class="flex items-center gap-3">
    <Avatar.Root>
      <Avatar.Image src={picture} alt="田中 葉月" />
      <Avatar.Fallback>田</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root>
      <Avatar.Image src="data:image/png;base64,broken" alt="佐藤 匠" />
      <Avatar.Fallback>佐</Avatar.Fallback>
    </Avatar.Root>
  </div>
</Story>

<Story
  name="With a name"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Next to the visible name, the picture is decorative: `alt=""`.',
      },
    },
  }}
>
  <div class="flex items-center gap-2 text-sm">
    <Avatar.Root>
      <Avatar.Image src={picture} alt="" />
      <Avatar.Fallback>田</Avatar.Fallback>
    </Avatar.Root>
    <span class="font-semibold">田中 葉月</span>
  </div>
</Story>

<Story name="Sizes" asChild>
  <div class="flex items-center gap-3">
    <Avatar.Root class="size-6 text-xs">
      <Avatar.Fallback>HT</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root>
      <Avatar.Fallback>HT</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root class="size-10">
      <Avatar.Fallback>HT</Avatar.Fallback>
    </Avatar.Root>
  </div>
</Story>
