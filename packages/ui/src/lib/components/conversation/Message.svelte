<script lang="ts">
  import type { Snippet } from 'svelte'
  import { AgentAvatar } from '../avatar/index.js'
  import { cn } from '#lib/utils.js'
  import type { PeerSender } from '../types.js'
  import Prose from './Prose.svelte'

  let {
    role,
    streaming = false,
    typing = false,
    from,
    class: className,
    children,
  }: {
    /** user: the pill; thinking: one sentence about the work; assistant: the bubble; peer: another agent. */
    role: 'user' | 'assistant' | 'thinking' | 'peer'
    /** The assistant's reply is still arriving: a caret after the last block. */
    streaming?: boolean
    /** On the latest thinking pill only: three dots at its end. */
    typing?: boolean
    /** Required for `peer`. */
    from?: PeerSender
    class?: string
    children: Snippet
  } = $props()
</script>

{#if role === 'user'}
  <div
    class={cn(
      'max-w-[70%] self-end rounded-[20px] bg-primary px-3.5 py-[7px] text-base leading-7 font-semibold whitespace-pre-wrap text-primary-foreground',
      className,
    )}
  >
    {@render children()}
  </div>
{:else if role === 'thinking'}
  <div
    class={cn(
      'inline-flex w-fit items-center gap-2 rounded-2xl bg-muted px-3.5 py-1.5 text-base leading-7',
      className,
    )}
  >
    <span>{@render children()}</span>
    {#if typing}
      <span class="typing inline-flex gap-[3px]" role="img" aria-label="作業中">
        <i></i><i></i><i></i>
      </span>
    {/if}
  </div>
{:else if role === 'peer'}
  <div
    class={cn(
      'w-fit max-w-[560px] rounded-2xl border border-border bg-background px-3.5 py-2.5',
      className,
    )}
  >
    {#if from}
      <div class="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <AgentAvatar color={from.avatar.color} pose={from.avatar.pose} size={20} badge={false} />
        <span class="font-semibold text-foreground">{from.slug}</span>
        <span class="font-mono">{from.agentId.slice(0, 8)}</span>
        <span>· hop {from.hop}</span>
      </div>
    {/if}
    <Prose>{@render children()}</Prose>
  </div>
{:else}
  <div class={cn('w-fit max-w-[560px] rounded-2xl bg-muted px-3.5 py-2.5', className)}>
    <Prose {streaming}>{@render children()}</Prose>
  </div>
{/if}

<style>
  .typing i {
    width: 5px;
    height: 5px;
    border-radius: 9999px;
    background: var(--muted-foreground);
    animation: dot 1.2s ease-in-out infinite;
  }
  .typing i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .typing i:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes dot {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing i {
      animation: none;
    }
  }
</style>
