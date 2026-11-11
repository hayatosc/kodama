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
- `src/lib/utils.ts`: `cn`, the prop helper types the components import, and `focusRing`, the
  shared focus style (an outline, so it survives forced colors mode).
- `src/lib/components/ui/`: the primitives, general-purpose parts in the shape of shadcn-svelte's
  (`Dialog.Root`, `Dialog.Trigger`, `Dialog.Content`, …), restyled from
  `design/components/bundle.css`. Where the platform has the element, they are built on it, as
  modern-web-guidance asks: Dialog and AlertDialog on the modal `<dialog>` opened with invoker
  commands, Popover on the Popover API with anchor positioning, Select on the customizable
  `<select>`, Switch on a checkbox with the `switch` attribute, KeyboardKey on `<kbd>`, and Input,
  Textarea, Label, Checkbox, RadioGroup, and Slider on the native form controls, Accordion
  on `<details>`, Progress and Spinner on `<progress>`, Table on the table elements,
  Card on `<article>`, Separator on `<hr>`, Toggle and ToggleGroup on `aria-pressed` buttons,
  DropdownMenu on an invoker-command popover with native focusgroup, Tooltip on interest invokers
  (`interestfor`) and a hint popover, Drawer on the same modal `<dialog>` as Dialog, and Toast on
  a manual popover announced with `ariaNotify`. Field links a control to its label, description,
  and error without hand-written ids. Tabs and
  Command (the searchable list) stay on bits-ui, which the platform has no element for. Button
  and Badge are shadcn-svelte's own. A searchable select is a composition, Popover with Command,
  shown in the Combobox stories. Variant tables and their types live in a `variants.ts` next to
  the component, because type-aware Oxlint cannot read named exports from `.svelte` files.
  `components.json` is written by hand because `shadcn-svelte init` asks for a preset
  interactively; `vp dlx shadcn-svelte@1.7.2 add <name>` still adds a bits-ui component to
  restyle, where no native element fits.
- `src/lib/styles/native.css`: the styles those native elements need beyond utilities: the
  dialog and popover transitions and backdrop, popover placement, the select's menu, the
  checkbox, radio, and slider drawn on their native inputs, the `<details>` chevron and slide,
  the progress bar and spinner, the drawer's slide, and the menu's and tooltip's placement and
  check marks.
- `src/lib/user-invalid.ts`: keeps `aria-invalid` in step with `:user-invalid`, so an error shows
  only after the user has interacted, and is announced as well as seen.
- `src/lib/top-layer.ts`: the dialog fallbacks for browsers without `overlay` (the exit
  transition) or `closedby` (closing on a backdrop click), and `placeWithoutAnchor`, which places
  a popover, menu, or tooltip by its trigger where anchor positioning is missing.
- `src/lib/hint.ts`: relates a tooltip to its trigger for assistive technology (its name or its
  description), as the interest-triggered-tooltips guide asks.
- `src/lib/polyfills.ts`: loads the `interestfor` polyfill, the only polyfill, and only where
  interest invokers are missing. Baseline features get none.
- `src/ambient.d.ts` and `src/elements.d.ts`: types for platform features the installed DOM and
  Svelte typings do not list yet (`ariaNotify`, `interestfor`, `focusgroup`).
- `src/lib/components/`: Kodama's own components, built on the primitives, from the next stages.
- `src/stories/`: stories that belong to no component (Foundations, compositions such as the
  Combobox, and later whole screens).
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
2. **Primitives** (done): Button, Badge, KeyboardKey, Switch, Tabs, Select, Combobox (Popover with
   Command), Dialog, AlertDialog, the form parts (Label, Input, Textarea, Field, InputGroup,
   Checkbox, RadioGroup, Slider), and the display parts (Accordion, Card,
   Separator, Callout, Avatar, Table, Item, Empty, Skeleton, Spinner, Progress), the action and
   overlay parts (ButtonGroup, Toggle, ToggleGroup, Tooltip, DropdownMenu, Drawer, Toast),
   general-purpose and shaped like shadcn-svelte's, with stories
   that show each one's uses rather than one screen's. Storybook lists the parts fit for any use
   under **Primitives** and those made for one use (AlertDialog, Drawer, Combobox, Toast,
   Callout, Empty) under **Patterns**; each Default story shows the part on its own. Native elements come first (see Layout);
   Baseline features are used without polyfills, and features short of Baseline get the fallback
   the guide gives.
3. **AgentAvatar**: the bird and birdhouse SVG, its poses, sizes, badge, and motion, ported from
   `design/components/bundle.js` and `bundle.css`.
4. **Conversation parts**: Message (user, assistant, thinking, peer), Prose (static Markdown),
   ToolCall, and Composer with its queue.
5. **Panel parts**: Sidebar, ActivityFeed, SettingsList, and ProfilePanel.
6. **Screens**: Workspace (three panes) and Mobile (list, conversation, sheet).
7. **Live screen**: WorkspaceLive, which replays an event sequence.

Streaming Markdown (Streamdown) and the connection to `AgentService` come after the mockups:
routes, Remote Functions, authentication, and `adapter-cloudflare`.
