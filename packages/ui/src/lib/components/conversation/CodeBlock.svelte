<script lang="ts">
  import CopyButton from './CopyButton.svelte'

  let { code, language }: { code: string; language?: string } = $props()
</script>

<!-- A fenced code block inside Prose: the language and a copy button above the code. -->
<div class="overflow-hidden rounded-lg border border-border bg-card">
  <div
    class="flex h-[30px] items-center justify-between border-b border-border pr-1.5 pl-3 font-mono text-xs text-muted-foreground"
  >
    <span>{language ?? 'text'}</span>
    <CopyButton text={code} />
  </div>
  <pre class="overflow-x-auto px-3 py-2.5 font-mono text-sm text-foreground"><code
      >{code}</code
    ></pre>
</div>
