import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Runes everywhere except dependencies, which may still use the legacy syntax.
        // The parameter is typed here because @rsvelte/vite-plugin-svelte's types import
        // CompileOptions from @rsvelte/compiler, which does not export it (the type lives in
        // @rsvelte/vite-plugin-svelte-native), so the contextual type is lost.
        runes: ({ filename }: { filename: string }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
    }),
  ],
})
