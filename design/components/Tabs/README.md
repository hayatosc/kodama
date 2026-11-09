# Tabs

The right pane's tabs, switching between an agent's 「詳細・記憶・ツール」 (Details / Memory / Tools). Each tab has a fixed content type.

- **What the caller passes:** the selected tab; each tab's content (Details = settings list, Memory = memory list and search, Tools = tool list and switches); and a change handler.
- **Tabs:** `role="tablist"`. Each tab is `h-8 px-3 rounded-md text-sm font-semibold`; the selected one is `bg-muted text-foreground`, the others `text-muted-foreground` (`text-foreground` on hover). Arrow keys move between them.
- **Details:** SettingsList (provider, model), routines, and activity.
- **Memory:** a search field at the top (`border-input` outline, magnifier). Each item shows a kind badge (事実・好み・手順 — fact / preference / procedure), its source and date (`text-xs text-muted-foreground`), and the body (`text-sm`). Hover is `bg-accent`; pressing opens an edit/delete menu.
- **Tools:** each row has the tool name (`font-mono font-semibold`), a description (`text-xs text-muted-foreground`), and a Switch at the right. System-managed tools are disabled.
- **Actions:** clicking a tab switches the panel (`aria-selected`).
- The implementation is shadcn-svelte's Tabs (bits-ui).
