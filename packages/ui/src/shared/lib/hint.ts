/**
 * Wires a hint popover (a tooltip) to its interest trigger for assistive technology, as the
 * interest-triggered-tooltips guide asks: browsers do not yet expose `interestfor` consistently,
 * so the relation is set explicitly, before the polyfill loads.
 *
 * @module
 */

/** Collapses runs of whitespace, so names compare as a screen reader reads them. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Text content with the `alt` of any image inside, as the accessible name takes it. */
function textWithAlt(element: Element): string {
  const parts: string[] = []
  for (const node of element.childNodes) {
    if (node instanceof Element) {
      if (node.getAttribute('aria-hidden') === 'true') continue
      if (node instanceof HTMLImageElement) parts.push(node.alt)
      else parts.push(textWithAlt(node))
    } else {
      parts.push(node.textContent ?? '')
    }
  }
  return parts.join(' ')
}

/** The trigger's accessible name: labelledby targets, else aria-label, else contents, else title. */
function accessibleName(trigger: Element): string {
  const labelledBy = trigger.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (normalize(text)) return normalize(text)
  }
  const label = normalize(trigger.getAttribute('aria-label') ?? '')
  if (label) return label
  const contents = normalize(textWithAlt(trigger))
  if (contents) return contents
  return normalize(trigger.getAttribute('title') ?? '')
}

/**
 * Relates a hint to the trigger that shows it on interest. A hint that repeats the trigger's
 * name gets nothing (it would be read twice). Otherwise the hint takes `role="tooltip"` and
 * becomes the trigger's name when it has none, or its description. Attributes the author
 * already set always win.
 */
export function wireHint(trigger: Element, hint: Element): void {
  const name = accessibleName(trigger)
  if (normalize(hint.textContent ?? '') === name) return
  if (!hint.hasAttribute('role')) hint.setAttribute('role', 'tooltip')
  if (!name) {
    if (!trigger.hasAttribute('aria-labelledby')) trigger.setAttribute('aria-labelledby', hint.id)
    return
  }
  if (!trigger.hasAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', hint.id)
}
