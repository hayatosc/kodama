# @kodama/ui

The Kodama web UI: SvelteKit 3 (Svelte 5 runes), Tailwind CSS v4, and shadcn-svelte, built from the
design system in [`design/`](../../design/README.md) and its
[SvelteKit guide](../../design/sveltekit.md).

For now the UI exists only as Storybook mockups with fixed mock data. It makes no network requests
and has no routes beyond a placeholder page.

## Commands

Run these from `packages/ui`:

- `vp run storybook`: start Storybook on port 6006.
- `vp run build-storybook`: build the static Storybook into `storybook-static/`.
- `vp run typecheck`: run `svelte-kit sync` and `rsvelte-check --tsgo`.
- `vp run typecheck:compat`: run the same UI check when CI checks agents with `tsc`.
- `vp run test`: run the unit tests, such as the check that the token copy matches `design/`.

Format from the repository root with `vp run format`. Vite+ formats non-Svelte files;
`scripts/format-svelte.ts` passes the same settings from the root `vite.config.ts` to `rsvelte-fmt`.

## Layout

- `src/app.css`: kiso.css (the reset, in place of Tailwind Preflight), Tailwind's theme and utilities,
  the fonts from npm (`gen-interface-jp`, `@fontsource/geist-mono`), and the token-to-utility mapping
  (`@theme inline`).
- `src/lib/styles/tokens.css`: a copy of `design/tokens.css` without its CDN font imports.
  `tokens.test.ts` fails when the two differ; copy the file again after exporting the design.
- `src/lib/utils.ts`: `cn` and the prop helper types that shadcn-svelte components import.
- `src/lib/components/ui/`: shadcn-svelte components (Button, Badge, Switch, Tabs,
  AlertDialog, Popover, Command), restyled to the design. `components.json` is written by hand
  because `shadcn-svelte init` asks for a preset interactively. Add components with
  `vp dlx shadcn-svelte@1.7.2 add <name>`, then restyle them from `design/components/bundle.css`
  and fit them to the lint rules (no `any`, no type assertions; weights 400 and 600 only).
  Variant tables and their types live in a `variants.ts` next to the component, because
  type-aware Oxlint cannot read named exports from `.svelte` files.
- `src/lib/components/`: the Kodama components built on them: `StatusBadge` and `UnreadCount`,
  `Keyboard` (the key hints of `design/components/Kbd`), `Select` (Popover + Command,
  shadcn-svelte's combobox recipe: a button opens a menu with the search field inside it, which
  bits-ui's input-based Combobox does not give), and `ConfirmDialog` (AlertDialog). The data
  the components share (agent states, select options, sidebar rows, activity, memories, tools)
  is typed in `src/lib/components/types.ts`, so TypeScript modules such as the story mock data
  (`src/stories/mock.ts`) can import it. `focusRing` in `src/lib/utils.ts` is the shared focus
  style.
- `src/stories/`: stories that belong to no component (Foundations, and later whole screens).
  A component's stories sit next to it as `<Name>.stories.svelte`.
- `.storybook/`: the toolbar switches `data-theme` between light and dark.

## Svelte tooling (rsvelte)

The Svelte tools are [rsvelte](https://github.com/baseballyama/rsvelte), a Rust port of the
Svelte 5 compiler and its tooling. It is pre-1.0, so each tool can be swapped back on its own:

| Job                                  | rsvelte                                                                               | Official tool it replaces              |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Compile (Vite, SvelteKit, Storybook) | `@rsvelte/vite-plugin-svelte`, through the `overrides` entry in `pnpm-workspace.yaml` | `@sveltejs/vite-plugin-svelte`         |
| Type check                           | `rsvelte-check --tsgo`                                                                | `svelte-check --tsgo`                  |
| Format                               | `rsvelte-fmt` for `.svelte` files, with Vite+ formatting settings                     | Prettier with `prettier-plugin-svelte` |
| Lint                                 | `@rsvelte/oxlint-plugin` in the root `vite.config.ts`                                 | eslint-plugin-svelte                   |

The override makes `pnpm peers check` report `@sveltejs/vite-plugin-svelte` 0.5.3 where
SvelteKit and Storybook ask for 7; that warning is expected.

Type checking uses TypeScript 7 like the rest of the workspace: `--tsgo` runs the native
compiler from `@typescript/native` (an npm alias of `typescript@7`). The `typescript` package
stays on 6 only because `svelte-kit sync` calls its JavaScript API, which TypeScript 7 does not
provide.

## Stages

The mockups are built in small steps, each reviewed in Storybook before the next begins.

1. **Foundation** (done): the package, tokens and fonts, the shadcn-svelte setup, Storybook
   with light and dark themes and a11y checks, and the Foundations stories (colors, type,
   spacing, radius, shadow).
2. **Primitives** (done) on shadcn-svelte: Button, StatusBadge (with the unread count), Keyboard,
   Switch, Tabs, Select (with search), and Dialog.
3. **AgentAvatar** (done): the bird and birdhouse SVG, its poses, sizes, badge, and motion, ported
   from `design/components/bundle.js` and `bundle.css` into `src/lib/components/avatar/`.
4. **Conversation parts** (done): Message (user, assistant, thinking, peer), Prose (the look of
   Markdown; it styles the elements it is given and never takes HTML), ToolCall, and Composer
   with its queue, in `src/lib/components/conversation/`.
5. **Panel parts** (done): AgentSidebar, ActivityFeed, SettingsList (with SettingsRow and
   SettingsAction), and ProfilePanel, in `src/lib/components/panel/`. Sidebar rows are buttons
   until the routes exist; they become links when the UI connects.
6. **Screens**: Workspace (three panes) and Mobile (list, conversation, sheet).
7. **Live screen**: WorkspaceLive, which replays an event sequence.

Streaming Markdown (Streamdown) and the connection to `AgentService` come after the mockups:
routes, Remote Functions, authentication, and `adapter-cloudflare`.
