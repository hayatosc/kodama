<script lang="ts">
  import { AgentAvatar } from '#entities/agent/@x/message.js'
  import { cn } from '#shared/lib/utils.js'
  import type { PeerSender } from '../model/message.js'
  import Prose from './Prose.svelte'
  import type { Snippet } from 'svelte'

  type Props = {
    /** The utterance: plain text for user and thinking, rendered Markdown otherwise. */
    children: Snippet
    class?: string
  } & (
    | { role: 'user' }
    | {
        role: 'thinking'
        /** Only the latest thinking pill shows the typing dots. */
        typing?: boolean
      }
    | {
        role: 'assistant'
        /** While the reply is still arriving, a caret follows its last block. */
        streaming?: boolean
      }
    | {
        role: 'peer'
        from: PeerSender
        streaming?: boolean
      }
  )

  const props: Props = $props()
</script>

<!--
  One utterance (design/components/Message). The four kinds differ by shape: the user's pill on
  the right, a thinking pill, the agent's bubble, and a bordered message from another agent with
  its sender above. The conversation is with one agent, so its bubbles carry no name; only peer
  messages do. Screen readers hear the user's pill introduced as theirs, since its shape alone
  does not say whose it is.
-->
{#if props.role === 'user'}
  <div
    data-slot="message"
    data-role="user"
    class={cn(
      'ms-auto w-fit max-w-[70%] rounded-3xl bg-primary px-3.5 py-1.75 text-base leading-7 font-semibold wrap-anywhere whitespace-pre-wrap text-primary-foreground',
      props.class,
    )}
  >
    <span class="sr-only">あなた: </span>{@render props.children()}
  </div>
{:else if props.role === 'thinking'}
  <div
    data-slot="message"
    data-role="thinking"
    class={cn(
      'inline-flex w-fit max-w-full items-center gap-2 rounded-2xl bg-muted px-3.5 py-1.5 text-base leading-7 text-foreground',
      props.class,
    )}
  >
    <span>{@render props.children()}</span>
    {#if props.typing}
      <span class="inline-flex gap-0.75" aria-hidden="true">
        {#each ['', 'motion-safe:[animation-delay:0.2s]', 'motion-safe:[animation-delay:0.4s]'] as delay (delay)}
          <i
            class={[
              'size-1.25 rounded-full bg-muted-foreground forced-colors:bg-[CanvasText] motion-safe:animate-typing',
              delay,
            ]}
          ></i>
        {/each}
      </span>
    {/if}
  </div>
{:else if props.role === 'assistant'}
  <div
    data-slot="message"
    data-role="assistant"
    class={cn('w-fit max-w-140 rounded-2xl bg-muted px-3.5 py-2.5', props.class)}
  >
    <Prose streaming={props.streaming}>{@render props.children()}</Prose>
  </div>
{:else}
  <div
    data-slot="message"
    data-role="peer"
    class={cn(
      'w-fit max-w-140 rounded-2xl border border-border bg-background px-3.5 py-2.5',
      props.class,
    )}
  >
    <p class="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <AgentAvatar color={props.from.color} pose={props.from.pose} size={20} badge={false} /><span
        class="font-semibold text-foreground">{props.from.slug}</span
      ><span class="font-mono">{props.from.agentId.slice(0, 8)}</span><span
        >· hop {props.from.hop}</span
      >
    </p>
    <Prose streaming={props.streaming}>{@render props.children()}</Prose>
  </div>
{/if}
