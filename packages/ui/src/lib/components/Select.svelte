<script lang="ts" module>
  /** One choice in a Select; `group` puts it under a heading such as 最新 (Latest). */
  export type SelectOption = {
    value: string
    label: string
    /** A second, muted line under the label. */
    hint?: string
    disabled?: boolean
    group?: string
  }
</script>

<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import * as Command from '#lib/components/ui/command/index.js'
  import * as Popover from '#lib/components/ui/popover/index.js'
  import { cn, focusRing } from '#lib/utils.js'

  let {
    options,
    value = $bindable(),
    onchange,
    searchable = options.length > 8,
    variant = 'field',
    mono = false,
    placeholder = '選択してください',
    searchPlaceholder = '検索',
    label,
    class: className,
  }: {
    options: SelectOption[]
    value?: string
    onchange?: (value: string) => void
    /** A search field at the top of the menu; on by default for lists longer than 8. */
    searchable?: boolean
    /** `field` has a border, for forms; `inline` is borderless, for settings rows. */
    variant?: 'field' | 'inline'
    /** Monospace labels, for model names. */
    mono?: boolean
    placeholder?: string
    searchPlaceholder?: string
    /**
     * What the select chooses, such as プロバイダー. It leads the trigger's accessible name, which
     * still contains the visible value (WCAG 2.5.3).
     */
    label?: string
    class?: string
  } = $props()

  let open = $state(false)

  const selected = $derived(options.find((option) => option.value === value))
  const shown = $derived(selected?.label ?? placeholder)

  /** Options grouped by heading, in the order each heading first appears. */
  const groups = $derived(
    options
      .map((option) => option.group)
      .filter((heading, index, headings) => headings.indexOf(heading) === index)
      .map((heading) => ({ heading, items: options.filter((option) => option.group === heading) })),
  )

  function choose(next: string): void {
    value = next
    open = false
    onchange?.(next)
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    aria-label={label === undefined ? undefined : `${label} ${shown}`}
    class={cn(
      'inline-flex cursor-pointer items-center text-sm text-foreground',
      variant === 'field'
        ? 'h-9 min-w-[220px] justify-between gap-2 rounded-lg border border-input bg-background px-2.5 data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-background'
        : 'h-7 gap-1 rounded-md px-2 hover:bg-accent',
      mono && 'font-mono',
      focusRing,
      className,
    )}
  >
    <span class={cn('truncate', !selected && 'text-muted-foreground')}>
      {shown}
    </span>
    <ChevronDownIcon
      class="size-4 shrink-0 text-muted-foreground"
      strokeWidth={1.75}
      aria-hidden="true"
    />
  </Popover.Trigger>
  <Popover.Content>
    <Command.Root>
      {#if searchable}
        <Command.Input placeholder={searchPlaceholder} />
      {/if}
      <Command.List>
        <Command.Empty>一致するものがありません</Command.Empty>
        {#each groups as group (group.heading ?? '')}
          <Command.Group heading={group.heading}>
            {#each group.items as option (option.value)}
              <Command.Item
                value={option.value}
                keywords={[option.label, option.hint ?? '']}
                disabled={option.disabled}
                checked={option.value === value}
                onSelect={() => choose(option.value)}
              >
                <span class={cn('block truncate', mono && 'font-mono')}>{option.label}</span>
                {#if option.hint}
                  <small class="block text-xs text-muted-foreground">{option.hint}</small>
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
