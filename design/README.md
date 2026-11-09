A place to live alongside agents that keep running for a long time. Kodama's UI shows each agent as a small bird living in its own birdhouse, so you can read at a glance who did what while you were not looking. The screen itself stays quiet in black and white; color is reserved for the birds and for status. Following Tailwind CSS v4 and shadcn naming conventions, token names become utilities directly, such as `bg-background` and `text-muted-foreground`.

## Principles

- **Agents are small birds in birdhouses.** The birdhouse stands for each agent's Durable Object: while asleep (waiting for an alarm, paused) the bird is inside; when an event arrives it peeks out of the hole and steps onto the perch. Each agent keeps one `agent-*` color for life (derived from its UUID; the user can change it). Poses and motion show what it is doing now: inspecting with a magnifier, pecking at paper to write, carrying a letter to another birdhouse, stretching awake. In lists and chat, the bird sits inside a full-circle avatar (the circle mixes in a faint tint of the agent's color). While asleep, the circle switches to a birdhouse of the same color (no bird inside), with z's rising. See AgentAvatar.
- **The main agent is special.** `assistant`, created first, sits in the large slot at the top of the sidebar and is drawn as the black bird `agent-ink`. It uses the same inverted color as the primary button and becomes the face of the product. Other agents sit in the list below; system agents sit further down in gray, quietly.
- **The screen is black and white; only birds and status carry color.** Surfaces and text are built from `background` `sidebar` `card` `muted` and `foreground` `muted-foreground`. There are only three status colors: `live` (new reply, link), `running` (in progress), and `destructive` (failure, destructive action).
- **Primary buttons and the user's speech are inverted.** `primary` is an alias of `foreground`: black with white text in light, white with black text in dark. Agent messages are gray `muted` bubbles; user messages are black `primary` pills.
- **Lines are thin; shadows are only for things that float.** Surfaces are separated by a 1px `border` and a difference in tone. `shadow-lg` is used only for the Composer, popovers, and menus.
- **Assume long spans of time.** Every row has a "when" and a "state". The transcript is replaced by snapshots rather than appended to, so it survives a broken stream.
- **Light is the default; dark is equal.** The theme order starts with `light` (the default). Both themes meet 4.5:1 for body text and 3:1 for control outlines and focus rings.

## Copy

- UI copy is Japanese; identifiers stay English. Agent names, slugs, tool names, and model names use `font-mono` or their original spelling and are never translated (`web_search`, `assistant`, `claude-sonnet-5-5`).
- Write states as short nouns: 稼働中 (active), 実行中 (running), 待機中 (waiting), 一時停止 (paused), 失敗 (failed), アーカイブ (archived). Only the detail panel shows the English lifecycle values (`active`, `paused`).
- Use relative times (今 (now), 2分前 (2 min ago), 3日 (3 days)) in lists and absolute times (`09:00`) in the activity feed.
- System copy (buttons, errors, settings) uses polite Japanese (です・ます). An agent's speech may follow that agent's voice, including plain form. Neither uses exclamation marks or emoji. An error states the cause and the next action, one sentence each: 「認証情報が見つかりません。設定から割り当ててください。」 ("Credentials not found. Assign them in settings.")
- Buttons end with a verb: 作成 (create), 送信 (send), 停止 (stop), ロールバック (roll back).

## Color

- Body text is `foreground`; supporting information (times, slugs, model names, tool summaries, placeholders) is `muted-foreground`. Both stay readable on `background` `sidebar` `card` `muted` `accent`.
- The agent list on the left is `sidebar`, the conversation pane is `background`, and floating surfaces are `card` or `popover`. The selected row is `muted`; hover is `accent`.
- Status colors always pair with a word or an icon. Never distinguish by color alone. Badge backgrounds are `live-soft` `running-soft` `destructive-soft`; their text is `live` `running` `destructive`.
- Agent colors (`agent-orange` `agent-yellow` `agent-green` `agent-teal` `agent-sky` `agent-blue` `agent-violet` `agent-plum` `agent-pink` `agent-red` `agent-brown`, 11 colors arranged around the hue wheel so neighbors differ clearly in lightness or hue) are used only on the bird's head, back, wings, and tail, and on the flag on the birdhouse roof. Never on text or borders. Because a color always appears next to a name, the color itself carries no meaning. The bird's face and belly are `bird-face` (a warm white) in both themes; eyes are `bird-eye`, cheeks `bird-blush`, beak `bird-beak` `bird-beak-top`, feet `bird-feet`.
- Birds and birdhouses adapt to the screen's colors. Bird colors are soft and muted; the face is a warm white; the beak and cheeks are a soft coral. The birdhouse inside the avatar is painted in the agent's color. The `house-*` grays are for scenes that draw a large birdhouse (the shared birdhouse for all agents); never use brown wood. The bird's white face and the birdhouse's lightness must always differ (so the bird does not blend into the house). The agent's color is only on the roof flag. The flag flutters when a letter arrives.
- Avatars look exactly the same in light and dark. The colors of the bird, circle, birdhouse, props, and status badge do not change with the theme (`agent-*` and `bird-*` have the same values in both themes; surfaces inside the circle are fixed to the light values). The same bird should be recognizable in every theme.
- `agent-ink` is reserved for the main agent. System agents are gray birds in `agent-system`.
- Never use green for status. Completion stays uncolored in `muted-foreground` (success should be quiet; only anomalies and work in progress draw the eye). The blue and orange pair remains distinguishable with color vision deficiency.
- Inputs and secondary buttons use `input` for their outline (3:1). `border` is a decorative rule; never make it the only outline of a control.

## Typography

- The typeface is Gen Interface JP (a UI typeface based on Inter and Noto Sans JP, balanced between Japanese and Latin; SIL OFL 1.1). Body and UI use `sans` (Gen Interface JP); page titles, pane headings, and the main agent's name use `display` (Gen Interface JP Display). Monospace is Geist Mono.
- Fonts load from the npm package `gen-interface-jp` (WOFF2 split by unicode-range). Only body weights 400 and 600 and Display 600 are used.
- There are only two weights, 400 and 600. To keep font loading light, do not use `font-medium` (500) or `font-bold`. Emphasis is 600; small headings and metadata stay at 400 and step down in color (`muted-foreground`).
- The UI default is `type-base` (16/24). List names, buttons, tool rows, pane headings, and inputs use it. Buttons, the selected row, and names use `type-base-semibold`.
- Conversation text layers `leading-7` on `type-base` (16/28). Japanese becomes hard to read when lines are tight, so only Prose (Markdown in the conversation) raises the line height.
- Dense parts and supporting text use `type-sm` (14/20): menu items, settings rows, tabs, the memory list, the second line of a list row. Times, badges, and small headings use `type-xs` (12/16).
- The main agent's name and pane headings use `type-lg`; only page titles on settings and empty states use `type-2xl`.
- Tool arguments and results and configuration JSON use `mono-sm` (14/20). The first 8 characters of a UUID, request IDs, and durations use `mono-xs`.

## Spacing and layout

- 4px steps (Tailwind's `--spacing: 0.25rem`). `spacing-4` is the same as `p-4`.
- The screen has three panes: the agent list on the left at 280px (`sidebar`), the conversation in the middle (column at most 960px; agent bubbles at most 560px on the left; the user's pill on the right), and the profile panel on the right at 320px. The right pane collapses below 1280px.
- Below 1024px is the phone's single pane (Mobile): switch between the list and the conversation, and open details in a sheet from the bottom. While a run is active, use an "Add to queue" button instead of Tab.
- Bubbles are `spacing-2`–`spacing-3` apart; where the speaker changes, `spacing-4` or more. The Composer floats at the bottom of the screen.
- A list row has a 36px avatar, the name, and metadata at the right edge; the second line holds the latest event. The main agent's special slot uses a 56px avatar.

## Radius and shadow

- Buttons, inputs, and tool calls use `radius-lg`; list rows, settings cards, and popovers use `radius-xl`; bubbles and the main agent's special slot use `radius-2xl`; the Composer, the user's pill, round buttons, and speaker chips use `radius-full`.
- There are only two shadows: `shadow-sm` (buttons, the main agent's special slot) and `shadow-lg` (the Composer, speaker chips, floating surfaces).

## Status

- The avatar's face and the small badge at its lower right (`running` `live` `destructive`) are the primary display. The second line of a list row and the badge's word always convey the same thing in words.
- An 8px dot (where there is no avatar): filled `live` = 稼働中 (active); blinking `running` = 実行中 (running); hollow circle = 待機中 (waiting); hollow square = 一時停止 (paused); `destructive` = 失敗 (failed); filled `muted-foreground` = アーカイブ (archived) or complete.
- Tool calls are collapsed by default into one line: "name · summary · duration". While running, a `running` dot replaces the arrow; on failure, the name and time turn `destructive`.
- While an agent is working, show a short one-sentence "thinking pill" (`muted`): 「research に論文側を頼んでくる。」 ("I'll ask research to check the paper side.") The voice may be that agent's own first person and plain form.
- Messages from other agents (`kodama.agent-message`) are not gray bubbles. They are outlined with `border`, and the header shows the sender's small avatar, name, first 8 UUID characters, and hop count.

## Motion

- Charm comes from behavior rather than illustration. Map movements such as sleeping, waking, holding a tool, and carrying a letter one-to-one to real events (the mapping is in AgentAvatar; the end-to-end screen sample is WorkspaceLive).
- Motion should feel alive: crouch before a jump (anticipation), follow a parabola in the air, squash and bounce on landing. A small bird flaps a few times and glides, spreading its wings to brake before landing. Wings and tail follow slightly late. Never slide from point to point at constant speed.
- Use motion only for changes in state: avatar poses (working sway, pen, breathing while asleep), the `running` dot blink (1.6s), the streaming caret, the collapse arrow rotation (150ms), and hover color changes (120ms).
- Under `prefers-reduced-motion: reduce`, stop avatar motion and blinking. Do not animate page transitions or list entries.

## Icons

- Use Lucide (`@lucide/svelte`), the same as shadcn, at 16px with a 1.75 stroke. This system ships no icon files (the SVGs in the previews are stand-ins that show the shape).
- Icons inherit the parent's text color. Supporting icons use `muted-foreground`; icons inside buttons match the text.
- Examples: another agent = `arrow-left-right`, alarm = `clock`, memory = `book-open`, settings = `sliders-horizontal`, expand tool = `chevron-right`, send = `arrow-up`, stop = filled `square`.

## Focus

- The focus ring is a 2px solid `ring` with a 2px offset (Tailwind `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`). `ring` stays at 3:1 or better on every surface.

## Viewing the previews

- Every card shows Light and Dark side by side. The same component is placed left and right or top and bottom so you can compare how it looks in each theme.

## About this folder

- This is the export of Kodama's design system (a claude.ai Design System artifact). To change the design, edit the artifact first, then export it here again.
- `tokens.json` is the source of the tokens. `tokens.css` is generated from it (CSS variables, text styles, and `@font-face`); do not edit it by hand.
- `components/<Name>/preview.html` opens directly in a browser (it loads `tokens.css`, `components/bundle.css`, and `components/bundle.js`). It shows Light and Dark side by side and responds to clicks and key presses.
- `components/<Name>/README.md` is each component's guide; `components/index.d.ts` holds the types of the values it accepts.
- `components/Cover/preview.html` is the cover illustration for this design system, not a component. It has no guide or type and is not part of the component list at the top of `bundle.js`.
- Fonts are not stored here. They load from the npm package `gen-interface-jp@0.8.0` (SIL OFL 1.1). The top of `tokens.css` imports `cdn/400.css`, `cdn/600.css`, and `cdn/display-600.css` from jsDelivr. When exporting from the artifact, empty `type.fonts` in `tokens.json` and do not bring a `fonts/` folder.
- `images/` holds PNG renders of Workspace and Mobile in light mode (2x resolution).
- The implementation guide is [sveltekit.md](sveltekit.md).
