<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import { cn } from '#shared/lib/utils.js'
  import * as Command from '../command/index.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import * as Popover from '../popover/index.js'
  import type { ComboboxOption } from './options.js'

  let {
    value = $bindable(''),
    options,
    label,
    placeholder = '選択してください',
    variant = 'field',
    mono = false,
    disabled = false,
    onchange,
    class: className,
  }: {
    /** The chosen option's value; empty while nothing is chosen. */
    value?: string
    /** Options with a `group` are listed under that heading, in the order the groups first appear. */
    options: readonly ComboboxOption[]
    /** What is being chosen: the trigger's name, with its value, and the search field's. */
    label: string
    /** Shown in the trigger while nothing is chosen. */
    placeholder?: string
    /** `field` is outlined, for forms; `inline` has no outline, for a settings row's right edge. */
    variant?: 'field' | 'inline'
    /** Monospaced values, such as model names. */
    mono?: boolean
    disabled?: boolean
    /** Called with the new value when the user chooses an option. */
    onchange?: (value: string) => void
    /** Classes for the trigger. */
    class?: string
  } = $props()

  const id = $props.id()
  const labelId = `${id}-label`
  const valueId = `${id}-value`

  let open = $state(false)

  // Inside a Field or a settings row, the trigger takes the field's id, description, and invalid
  // state.
  const field = getFieldState()
  const attributes = $derived(fieldControlAttributes(field, {}))

  const chosen = $derived(options.find((option) => option.value === value))

  /** The options split by group, in the order each group first appears. */
  const groups = $derived.by(() => {
    const list: { name: string; items: ComboboxOption[] }[] = []
    for (const option of options) {
      const name = option.group ?? ''
      const group = list.find((candidate) => candidate.name === name)
      if (group) group.items.push(option)
      else list.push({ name, items: [option] })
    }
    return list
  })

  function choose(option: ComboboxOption): void {
    value = option.value
    open = false
    onchange?.(option.value)
  }
</script>

<!--
  A searchable select: a Popover holding a Command (design/components/Select, with search). The
  trigger is named by the label and the current value together, so a screen reader says what is
  being chosen and what is chosen now. Opening it focuses the search field; arrow keys move,
  Enter chooses and closes, and Esc or a click outside closes it and returns focus to the
  trigger. For a short list without search, use Select.
-->
<span id={labelId} class="sr-only">{label}</span>
<Popover.Root bind:open>
  <Popover.Trigger
    variant={variant === 'field' ? 'secondary' : 'ghost'}
    {disabled}
    id={attributes.id}
    aria-labelledby={`${labelId} ${valueId}`}
    aria-describedby={attributes['aria-describedby']}
    aria-invalid={attributes['aria-invalid']}
    data-slot="combobox-trigger"
    class={cn(
      variant === 'field'
        ? 'h-9 w-[220px] justify-between px-2.5 text-sm font-normal'
        : 'h-7 max-w-full gap-1 rounded-md px-2 text-sm font-normal',
      className,
    )}
  >
    <span
      id={valueId}
      class={cn('min-w-0 truncate', !chosen && 'text-muted-foreground', mono && 'font-mono text-xs')}
    >
      {chosen ? (chosen.label ?? chosen.value) : placeholder}
    </span>
    <ChevronDownIcon class="text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content class="w-[260px] p-0" align={variant === 'field' ? 'start' : 'end'}>
    <Command.Root>
      <Command.Input placeholder="検索" aria-label={`${label}を検索`} data-autofocus />
      <Command.List>
        <Command.Empty>一致するものがありません</Command.Empty>
        {#each groups as group, index (group.name)}
          {#if index > 0}<Command.Separator />{/if}
          <Command.Group heading={group.name || undefined}>
            {#each group.items as option (option.value)}
              <Command.Item
                value={option.value}
                keywords={option.label ? [option.label] : undefined}
                disabled={option.disabled}
                checked={option.value === value}
                onSelect={() => choose(option)}
              >
                <span class={cn(mono && 'font-mono text-xs')}>{option.label ?? option.value}</span>
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
