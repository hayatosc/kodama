<script lang="ts">
  import InfoIcon from '@lucide/svelte/icons/info'
  import type { Snippet } from 'svelte'
  import { Button } from '../ui/button/index.js'
  import { cn } from '#lib/utils.js'

  let {
    sidebar,
    panel,
    children,
    panelOpen = $bindable(false),
    class: className,
  }: {
    /** The left pane: AgentSidebar. */
    sidebar: Snippet
    /** The right pane: ProfilePanel. */
    panel: Snippet
    /** The center: the conversation. It has no header bar. */
    children: Snippet
    /** Below 1280px the right pane is folded away; this opens it over the conversation. */
    panelOpen?: boolean
    class?: string
  } = $props()
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (panelOpen = false)} />

<!--
  design/components/Workspace: 280px | conversation | 320px. Below 1280px (xl) the right pane
  folds behind the details button; below 1024px the phone layout (Mobile) takes over.
-->
<div
  class={cn(
    'grid h-dvh grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-background xl:grid-cols-[280px_minmax(0,1fr)_320px]',
    className,
  )}
>
  <div class="min-h-0 overflow-y-auto">{@render sidebar()}</div>
  <main class="relative min-h-0">
    <Button
      size="circle"
      class="absolute top-3 right-3 z-20 xl:hidden"
      aria-label="詳細"
      aria-expanded={panelOpen}
      onclick={() => (panelOpen = !panelOpen)}
    >
      <InfoIcon strokeWidth={1.75} />
    </Button>
    {@render children()}
  </main>
  <div
    class={cn(
      'min-h-0 overflow-y-auto bg-background',
      'max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:shadow-lg',
      !panelOpen && 'max-xl:hidden',
    )}
  >
    {@render panel()}
  </div>
</div>
