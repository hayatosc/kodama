# @kodama/ui

The Kodama web UI: SvelteKit 3 (Svelte 5 runes), Tailwind CSS v4, and shadcn-svelte, built from the
design system in [`design/`](../../design/README.md) and its
[SvelteKit guide](../../design/sveltekit.md).

For now the UI exists only as Storybook mockups with fixed mock data. It makes no network requests
and has no routes beyond a placeholder page.

## Commands

Run these from `packages/ui`:

- `nr storybook`: start Storybook on port 6006.
- `nr build-storybook`: build the static Storybook into `storybook-static/`.
- `nr build-storybook:html`: build the whole Storybook as one HTML file, `storybook.html`. It
  opens straight in a browser, with no server and no other files.
- `nr typecheck`: run `svelte-kit sync` and `rsvelte-check --tsgo`.
- `nr test`: run the unit tests, such as the check that the token copy matches `design/`.

Format from the repository root with `nr format`.

## Layout

- `src/app.css`: Tailwind and the token-to-utility mapping (`@theme inline`).
- `src/lib/styles/fonts.css`: the fonts from npm (`gen-interface-jp`, `@fontsource/geist-mono`),
  imported by the app and Storybook. `fonts-cdn.css` loads the same fonts from jsDelivr for the
  single HTML file.
- `src/lib/styles/tokens.css`: a copy of `design/tokens.css` without its CDN font imports.
  `tokens.test.ts` fails when the two differ; copy the file again after exporting the design.
- `src/lib/utils.ts`: `cn` and the prop helper types that shadcn-svelte components import.
- `src/lib/components/ui/`: shadcn-svelte components. `components.json` is written by hand
  because `shadcn-svelte init` asks for a preset interactively. Add components with
  `pnpm dlx shadcn-svelte@1.7.2 add <name>`, then adapt them to the design and the lint rules
  (no `any`, no type assertions).
- `src/stories/`: stories that belong to no component (Foundations, and later whole screens).
  A component's stories sit next to it as `<Name>.stories.svelte`.
- `.storybook/`: the toolbar switches `data-theme` between light and dark.
- `scripts/storybook-html.ts`: turns the single-file build into `storybook.html` (see below).

## Storybook as one HTML file

Every pull request that touches the UI gets its Storybook as one HTML file. The **Storybook**
workflow (`.github/workflows/storybook.yml`) builds it and uploads it with
`actions/upload-artifact`'s `archive: false`, which stores the file unzipped, so it opens in
the browser. The workflow then posts the link on the pull request and updates that comment on
every push. Viewing it needs read access to the repository, and the file is kept for 14 days.

`archive: false` takes a single file, and a normal Storybook build is hundreds. So
`nr build-storybook:html` builds a different shape:

1. With `STORYBOOK_SINGLE_FILE=1`, `.storybook/main.ts` adds `vite-plugin-singlefile`, so
   Storybook's preview (`iframe.html`) carries all of its JavaScript and CSS. It also drops
   Storybook's module-mocking entry (the stories do not use `sb.mock`; the extra entry stops
   inlining) and swaps the npm fonts for `fonts-cdn.css` (all font subsets would add about
   11 MB).
2. `scripts/storybook-html.ts` embeds the story index, inlines Storybook's remaining assets as
   data URLs, and adds `scripts/storybook-html-runtime.ts`. That small script stands in for the
   Storybook manager: a sidebar of stories and docs, a light/dark switch, and deep links such as
   `storybook.html#foundations-colors--palette`. It drives the preview through Storybook's own
   channel, the same way the manager does.

The build fails if the page still refers to any file next to it. The page is about 3 MB and
loads only its fonts from the network. The a11y panel and controls belong to the Storybook
manager, so they appear only in `nr storybook`.

## Svelte tooling (rsvelte)

The Svelte tools are [rsvelte](https://github.com/baseballyama/rsvelte), a Rust port of the
Svelte 5 compiler and its tooling. It is pre-1.0, so each tool can be swapped back on its own:

| Job                                  | rsvelte                                                                               | Official tool it replaces              |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Compile (Vite, SvelteKit, Storybook) | `@rsvelte/vite-plugin-svelte`, through the `overrides` entry in `pnpm-workspace.yaml` | `@sveltejs/vite-plugin-svelte`         |
| Type check                           | `rsvelte-check --tsgo`                                                                | `svelte-check --tsgo`                  |
| Format                               | `rsvelte-fmt` from the repository root (Oxfmt for every other file)                   | Prettier with `prettier-plugin-svelte` |
| Lint                                 | `@rsvelte/oxlint-plugin` in `.oxlintrc.json`                                          | eslint-plugin-svelte                   |

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
2. **Primitives** on shadcn-svelte: Button, StatusBadge (with the unread count), Kbd, Switch,
   Tabs, Select (with search), and Dialog.
3. **AgentAvatar**: the bird and birdhouse SVG, its poses, sizes, badge, and motion, ported from
   `design/components/bundle.js` and `bundle.css`.
4. **Conversation parts**: Message (user, assistant, thinking, peer), Prose (static Markdown),
   ToolCall, and Composer with its queue.
5. **Panel parts**: Sidebar, ActivityFeed, SettingsList, and ProfilePanel.
6. **Screens**: Workspace (three panes) and Mobile (list, conversation, sheet).
7. **Live screen**: WorkspaceLive, which replays an event sequence.

Streaming Markdown (Streamdown) and the connection to `AgentService` come after the mockups:
routes, Remote Functions, authentication, and `adapter-cloudflare`.
