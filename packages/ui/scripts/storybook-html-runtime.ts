/**
 * Browser code that `storybook-html.ts` inlines at the top of the single-file Storybook. It runs
 * as a classic script before Storybook boots: it answers Storybook's `index.json` request from
 * the embedded index, and adds a sidebar that selects stories and switches the theme through
 * Storybook's own channel, the way the Storybook manager does.
 *
 * It must not import or export anything: it is injected as plain script text.
 *
 * @module
 */

/** One sidebar entry from Storybook's story index. */
type IndexEntry = { id: string; title: string; name: string; type: 'story' | 'docs' }

/** The channel events the Storybook manager sends to the preview. */
const SET_CURRENT_STORY = 'setCurrentStory'
const UPDATE_GLOBALS = 'updateGlobals'

/** The text of an embedded `<script type="application/json">` element. */
function embeddedText(id: string): string | undefined {
  return document.getElementById(id)?.textContent ?? undefined
}

/** The story index entries in index order, keeping only well-formed stories and docs. */
function readEntries(indexText: string): IndexEntry[] {
  const index: unknown = JSON.parse(indexText)
  if (typeof index !== 'object' || index === null || !('entries' in index)) return []
  const { entries } = index
  if (typeof entries !== 'object' || entries === null) return []
  return Object.values(entries).flatMap((entry: unknown): IndexEntry[] => {
    if (typeof entry !== 'object' || entry === null) return []
    if (!('id' in entry) || !('title' in entry) || !('name' in entry) || !('type' in entry)) {
      return []
    }
    const { id, title, name, type } = entry
    if (typeof id !== 'string' || typeof title !== 'string' || typeof name !== 'string') return []
    if (type !== 'story' && type !== 'docs') return []
    return [{ id, title, name, type }]
  })
}

/** Serves `index.json` from the embedded copy; every other request goes to the network. */
function serveIndex(indexText: string): void {
  const networkFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const href = input instanceof Request ? input.url : String(input)
    if (new URL(href, location.href).pathname.endsWith('/index.json')) {
      const headers = { 'content-type': 'application/json' }
      return Promise.resolve(new Response(indexText, { headers }))
    }
    return networkFetch(input, init)
  }
}

/** Sends an event on Storybook's preview channel, once the preview has created it. */
function emit(event: string, payload: unknown): boolean {
  const channel: unknown = Reflect.get(globalThis, '__STORYBOOK_ADDONS_CHANNEL__')
  if (typeof channel !== 'object' || channel === null || !('emit' in channel)) return false
  const send = channel.emit
  if (typeof send !== 'function') return false
  Reflect.apply(send, channel, [event, payload])
  return true
}

/** Resolves once Storybook's preview has loaded the story index. */
async function previewReady(): Promise<void> {
  for (;;) {
    const preview: unknown = Reflect.get(globalThis, '__STORYBOOK_PREVIEW__')
    if (
      typeof preview === 'object' &&
      preview !== null &&
      'storeInitializationPromise' in preview
    ) {
      await preview.storeInitializationPromise
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Styles for the sidebar, drawn with the design tokens so it follows the theme. */
const STYLE = `
  body { margin-left: 16rem !important; }
  #kodama-nav { position: fixed; inset: 0 auto 0 0; z-index: 2147483647; width: 16rem;
    overflow-y: auto; box-sizing: border-box; padding: 16px 12px; display: flex;
    flex-direction: column; gap: 16px; background: var(--sidebar); color: var(--foreground);
    border-right: 1px solid var(--border); font: 14px/20px var(--font-sans); }
  #kodama-nav h1 { margin: 0; font: 600 18px/28px var(--font-display); }
  #kodama-nav p { margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 16px; }
  #kodama-nav h2 { margin: 0 0 4px; padding: 0 8px; color: var(--muted-foreground);
    font-size: 12px; line-height: 16px; font-weight: 400; }
  #kodama-nav ul { margin: 0; padding: 0; list-style: none; }
  #kodama-nav button { all: unset; box-sizing: border-box; cursor: pointer; border-radius: 8px; }
  #kodama-nav button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  #kodama-nav .entry { display: block; width: 100%; padding: 6px 8px; }
  #kodama-nav .entry:hover { background: var(--accent); }
  #kodama-nav .entry[aria-current='true'] { background: var(--muted); font-weight: 600; }
  #kodama-nav .themes { display: flex; gap: 4px; padding: 2px; border-radius: 10px;
    background: var(--muted); }
  #kodama-nav .themes button { flex: 1; text-align: center; padding: 4px 0; }
  #kodama-nav .themes button[aria-pressed='true'] { background: var(--background);
    box-shadow: var(--shadow-sm); font-weight: 600; }
`

/** Creates an element with text content and attributes. */
function element(tag: string, text = '', attributes: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag)
  node.textContent = text
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  return node
}

/** Builds the sidebar: build info, a light/dark switch, and the entries grouped by title. */
function renderNav(entries: IndexEntry[], buildInfo: string | undefined): void {
  const style = element('style', STYLE)
  const nav = element('nav', '', { id: 'kodama-nav', 'aria-label': 'Stories' })
  const header = element('div')
  header.append(element('h1', 'Kodama UI'))
  header.append(element('p', buildInfo ?? 'Storybook in one HTML file'))
  nav.append(header)

  const themes = element('div', '', { class: 'themes', role: 'group', 'aria-label': 'Theme' })
  const themeButtons = ['light', 'dark'].map((theme) => {
    const label = theme === 'light' ? 'Light' : 'Dark'
    const button = element('button', label, { type: 'button', 'aria-pressed': 'false' })
    button.addEventListener('click', () => selectTheme(theme))
    themes.append(button)
    return { theme, button }
  })
  nav.append(themes)

  const groups = new Map<string, IndexEntry[]>()
  for (const entry of entries) groups.set(entry.title, [...(groups.get(entry.title) ?? []), entry])
  const entryButtons = new Map<string, HTMLElement>()
  for (const [title, group] of groups) {
    const section = element('section')
    section.append(element('h2', title))
    const list = element('ul')
    for (const entry of group) {
      const item = element('li')
      const button = element('button', entry.name, { type: 'button', class: 'entry' })
      button.addEventListener('click', () => selectEntry(entry))
      entryButtons.set(entry.id, button)
      item.append(button)
      list.append(item)
    }
    section.append(list)
    nav.append(section)
  }
  document.head.append(style)
  document.body.prepend(nav)

  function selectTheme(theme: string): void {
    if (!emit(UPDATE_GLOBALS, { globals: { theme } })) return
    for (const { theme: value, button } of themeButtons) {
      button.setAttribute('aria-pressed', String(value === theme))
    }
  }

  function selectEntry(entry: IndexEntry): void {
    const viewMode = entry.type === 'docs' ? 'docs' : 'story'
    if (!emit(SET_CURRENT_STORY, { storyId: entry.id, viewMode })) return
    history.replaceState(null, '', `#${entry.id}`)
    for (const [id, button] of entryButtons)
      button.setAttribute('aria-current', String(id === entry.id))
  }

  const linked = entries.find((entry) => `#${entry.id}` === location.hash)
  const first = linked ?? entries[0]
  void previewReady().then(() => {
    selectTheme('light')
    if (first) selectEntry(first)
  })
}

/** Wires everything up; Storybook's own scripts run after this one. */
function start(): void {
  const indexText = embeddedText('kodama-story-index')
  if (indexText === undefined) return
  serveIndex(indexText)
  const buildInfo = embeddedText('kodama-build-info')
  const entries = readEntries(indexText)
  document.addEventListener('DOMContentLoaded', () => renderNav(entries, buildInfo))
}

start()
