# AgentAvatar

The agent's face: a small bird living in its own birdhouse, held in a round avatar. The whole bird sits inside the circle with padding down to the tips of its feet; the circle mixes in a faint tint of the agent's color. Color identifies who; pose and motion show what it is doing now. While asleep or paused, the circle switches to a birdhouse of the same color.

- **What the caller passes:** `color` (11 colors: orange / yellow / green / teal / sky / blue / violet / plum / pink / red / brown; the main agent is ink, the system agent is system. Derived from the UUID and changeable by the user), `pose`, and when needed `prop` (`lens` `pen` `letter`) and `mark` (`?` `!`), `size` (20 / 36 / 56 / 72). Poses are derived from the event stream; the component holds no state itself.
- The bird is a finch facing right, at a slight angle (nearly frontal three-quarters). Head and body form one continuous round shape; head, back, wings, and forked tail are `agent-*`; face and belly are `bird-face` (a warm white). The eyes are small vertical ovals with a highlight, placed on either side of the beak. The beak is a short wedge (upper `bird-beak-top`, lower `bird-beak`, seam `bird-bill-line`). The cheeks are two ovals split left and right (`bird-blush`). The feet are thin three-toed lines (`bird-feet`).
- No black outlines. The body edge is a 0.4 line of the color mixed toward white; the wings have two darker lines of the same color. At 28px and below, omit the wing lines, eye highlights, beak seam, and cheeks, and make the feet slightly thicker.
- The size inside the circle changes with the pose: normally 0.93; `happy` `live` `stretch`, which raise the wings, 0.84; `listen` (leaning toward the hands), 0.85; `tilt`, 0.80. None may clip the wings or tail against the circle.
- Keep the bird at about 70% of the circle's diameter, leaving margin at the top and sides. Center the drawn extent of the bird (from tail tip to the right edge of the face) on the circle's center. Because the tail extends left, place the body slightly right of center. Make the sleeping birdhouse about the same size so switching does not change the apparent size.
- The circle is `color-mix(in oklab, var(--agent-*) 18%, var(--background))`. The avatar is always a perfect circle and never lets the bird or birdhouse overflow (only the badge at the lower right leaves the circle).
- The birdhouse inside the circle has walls in the agent's color; the side, roof, and post are darker mixes toward black (`color-mix`). No bird is drawn inside; the hole stays dark. While asleep, a white "z" rises from the hole (so the bird and birdhouse do not appear to swap sizes).
- **Exactly the same in light and dark.** The colors of the circle, bird, birdhouse, props, and badge do not change with the theme. Surfaces inside the circle (`background`, `foreground`, etc.) are fixed to the light values; only the badge ring follows the surface it sits on.
- **Principle:** motion always corresponds to a real event. No meaningless random motion (the exceptions are breathing and blinking).

| Event                                    | pose              | Display                   | Motion                                                                                    |
| ---------------------------------------- | ----------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| Idle                                     | `idle`            | Bird                      | Breathes slowly, blinks twice occasionally, tail sways                                    |
| User is typing                           | `listen`          | Bird                      | Tilts its whole body toward the hands (the input). Peers over the input field             |
| `tool_execution_start`                   | `work`            | Bird + `lens` (automatic) | Looks through the magnifier, left and right                                               |
| `message_update`                         | `write`           | Bird + `pen` (automatic)  | Runs the pen held in its beak across the paper at its chest; lines are added to the paper |
| `contact_agent`                          | `idle` + `letter` | Bird                      | Holds a letter, crouches, then flies to the other birdhouse                               |
| `tool_execution_end` / `submission` done | `happy`           | Bird                      | Raises its wings and does a small squash-and-bounce jump (once). Wings wave slowly        |
| Reply arrived / unread                   | `live`            | Bird + blue badge         | Smiling eyes, raises and waves its wings                                                  |
| `submission` unanswered                  | `tilt`            | Bird + `?`                | Tilts its head                                                                            |
| cancel                                   | `surprised`       | Bird + `!`                | Opens its eyes wide and hops (once)                                                       |
| Alarm fires / resumes                    | `stretch`         | Bird                      | Raises its wings and stretches, swaying side to side (once)                               |
| No credentials                           | `worried`         | Bird + red badge          | Knits its brows, fidgets                                                                  |
| Failure                                  | `error`           | Bird + red badge          | × eyes                                                                                    |
| Waiting for an alarm                     | `sleep`           | Same-color birdhouse + z  | "z"s rise from the hole in sequence and fade                                              |
| lifecycle paused                         | `paused`          | Gray birdhouse            | Still                                                                                     |

- (When animated on screen) Leaving the birdhouse: opens its eyes in the back of the hole with a small start, peeks out and looks around, crouches, then jumps to the perch on a parabola. It squashes and bounces on landing and flaps. The reverse when returning: it enters the hole head first.
- Delivering a letter: flies like a small bird, flapping a few times and gliding, lands on the other birdhouse's roof, and spreads its wings to brake. On landing the birdhouse shakes and the flag flutters; the recipient wakes, comes out, and takes the letter.
- While holding a prop, do not show the badge at the lower right. At 20px, drop the prop and mark and communicate with the face alone.
- Under `prefers-reduced-motion: reduce`, stop motion and convey the state with the pose switch and the second line of the list row.
- The SVGs are `bird()` (origin at the bird's center; feet at y = 18.5), `house()` (viewBox `10 10 100 112`; hole center 58,62; perch top y = 77.5), and `avatar()` in `components/bundle.js`. Motion is `kd-p-*` in `components/bundle.css`. In Svelte, move them to `AgentAvatar.svelte` and `Birdhouse.svelte`, and write entering, leaving, and flight with the Web Animations API (`element.animate`).

```svelte
<AgentAvatar color="violet" pose="write" size={36} />
<AgentAvatar color="teal" pose="sleep" size={36} />  <!-- sleeping in a same-color birdhouse -->
```
