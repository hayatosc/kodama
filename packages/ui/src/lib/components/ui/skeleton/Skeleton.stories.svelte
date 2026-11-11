<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Skeleton from './skeleton.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Skeleton',
    component: Skeleton,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Placeholder shapes in the layout of content that is still loading, so the page does not jump when it arrives. They are hidden from assistive technology; say once, in a `role="status"` region, that the content is loading. They pulse only without a reduced-motion request.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Skeleton class="h-4 w-48" />
</Story>

<Story name="Loading a list" asChild>
  <div class="flex w-80 flex-col gap-4">
    <p role="status" class="sr-only">会話を読み込んでいます</p>
    {#each [0, 1, 2] as row (row)}
      <div class="flex items-center gap-3">
        <Skeleton class="size-8 rounded-full" />
        <div class="flex flex-1 flex-col gap-2">
          <Skeleton class="h-3.5 w-2/5" />
          <Skeleton class="h-3 w-4/5" />
        </div>
      </div>
    {/each}
  </div>
</Story>
