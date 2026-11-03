<script lang="ts">
  import '../app.css'
  import '#lib/styles/fonts.css'
  import type { LayoutProps } from './$types'

  let { children }: LayoutProps = $props()
</script>

{@render children()}
