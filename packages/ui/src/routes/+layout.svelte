<script lang="ts">
  import '#app/styles/index.css'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
</script>

{@render children()}
