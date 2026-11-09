<script lang="ts">
  import { Command as CommandPrimitive, useId } from 'bits-ui'
  import { cn } from '#lib/utils.js'

  let {
    ref = $bindable(null),
    class: className,
    children,
    heading,
    value,
    ...restProps
  }: CommandPrimitive.GroupProps & {
    /** Shown above the group's items in muted extra-small text. */
    heading?: string
  } = $props()
</script>

<CommandPrimitive.Group
  bind:ref
  data-slot="command-group"
  class={cn(className)}
  value={value ?? heading ?? `----${useId()}`}
  {...restProps}
>
  {#if heading}
    <CommandPrimitive.GroupHeading class="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
      {heading}
    </CommandPrimitive.GroupHeading>
  {/if}
  <CommandPrimitive.GroupItems {children} />
</CommandPrimitive.Group>
