# Switch

A switch that toggles on and off immediately. Used to enable or disable tools.

- **What the caller passes:** `checked`, `disabled`, a change handler, and a label (adjacent text or `aria-label`).
- Shape: `w-[34px] h-5 rounded-full`. Off is `bg-input`; on is `bg-primary` (inverted). The knob is a 16px circle: `bg-background` off, `bg-primary-foreground` on. It moves in 150ms.
- `role="switch"` and `aria-checked`. Space toggles. Disabled is 40% opacity; write the reason in the row's description.
- Use it only for settings that apply the moment they are pressed. Use a checkbox for settings that need a save button.
- The implementation is shadcn-svelte's Switch (bits-ui).
