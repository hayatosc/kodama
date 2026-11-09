# Dialog

A confirmation dialog shown before an action that is hard to undo.

- **What the caller passes:** a title (「〜しますか？」, "Do you want to …?"), an explanation of what will happen, the confirm button label (a verb), and cancel and confirm handlers.
- The backdrop is a 32% black scrim. The box is `w-[400px] p-6 bg-popover border rounded-xl shadow-lg`.
- The title is `font-display text-lg font-semibold`. The explanation is `text-base text-muted-foreground` and states what is lost, what remains, and whether it can be undone.
- Buttons are right-aligned, cancel (secondary) then confirm. A destructive confirm is filled `bg-destructive` (black text in dark).
- `role="alertdialog"`. Focus cancel on open; Esc and a scrim click cancel.
- The implementation is shadcn-svelte's AlertDialog (bits-ui).
