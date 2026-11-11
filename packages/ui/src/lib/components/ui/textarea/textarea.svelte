<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#lib/utils.js'
  import { syncUserInvalid } from '#lib/user-invalid.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLTextareaAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    ...restProps
  }: WithElementRef<HTMLTextareaAttributes, HTMLTextAreaElement> = $props()

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': invalid,
    }),
  )
  const controlled = $derived(attributes['aria-invalid'] !== undefined)
</script>

<!--
  A native textarea that grows with its text (form-fields-automatically-fit-contents): at least
  three lines, at most ten, then it scrolls. Its width stays fixed so typing never shifts it
  sideways, and it can still be resized by hand.
-->
<textarea
  bind:this={ref}
  bind:value
  data-slot="textarea"
  {...attributes}
  class={cn(
    'flex max-h-[10lh] min-h-[3lh] w-full min-w-0 resize-y rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground field-sizing-content',
    'placeholder:text-muted-foreground',
    'user-invalid:border-destructive aria-invalid:border-destructive',
    'disabled:cursor-not-allowed disabled:opacity-40',
    focusRing,
    className,
  )}
  {@attach controlled ? undefined : syncUserInvalid}
  {...restProps}></textarea>
