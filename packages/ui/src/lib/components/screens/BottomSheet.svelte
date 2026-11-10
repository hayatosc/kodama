<script lang="ts">
  import { Dialog } from 'bits-ui'
  import type { Snippet } from 'svelte'

  let {
    open = $bindable(false),
    label,
    children,
  }: {
    open?: boolean
    /** The sheet's accessible name, such as エージェントの詳細. */
    label: string
    children: Snippet
  } = $props()
</script>

<!--
  The phone's details sheet (design/components/Mobile): it rises from the bottom with a 20px
  radius and a grab handle over a 32% scrim. The scrim, the content's ×, and Esc close it.
-->
<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-50 bg-black/32 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
    />
    <Dialog.Content
      aria-label={label}
      class="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[480px] flex-col overflow-y-auto rounded-t-[20px] bg-background pb-[env(safe-area-inset-bottom)] shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-6 motion-reduce:animate-none"
    >
      <Dialog.Title class="sr-only">{label}</Dialog.Title>
      <div aria-hidden="true" class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border"></div>
      {@render children()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
