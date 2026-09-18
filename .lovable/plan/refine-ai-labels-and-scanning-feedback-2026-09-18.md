# Refine AI labels and scanning feedback

## What will change

- Remove the clear `X` from inside the AI input so the field can use the full available width.
- Tighten the top control row by removing the unnecessary right-side spacing around the AI field.
- Place the clear icon immediately after the last label chip in the label row, using the open space at the top-right of the preview. It will keep its tooltip and accessible name, and only appear while labels exist.
- Keep each colored label above its matching vertical line as an overlay, so the document text remains full width.

## Navigate repeated matches

- Group matches by label and preserve their document order.
- When a label has another occurrence after it, show a tiny downward arrow at the bottom of that occurrence’s vertical line.
- Clicking the arrow scrolls directly to the next occurrence of the same label.
- The final occurrence in each label group has no arrow.
- Arrow controls remain outside the text flow and respect reduced-motion preferences.

## Scanning animation

- As soon as **Find** is pressed, overlay the whole Preview area with a subtle animated shimmer/sweep that reads as document analysis without obscuring the content.
- Keep the document visible beneath the effect and prevent duplicate Find actions while analysis is running.
- Stop and remove the shimmer immediately when results or an error return.
- Disable the animation for people who prefer reduced motion, using a quiet translucent loading treatment instead.
- Show the effect only in Preview; if Find starts from Edit, switch to Preview immediately so the scan is visible.

## Validation

- Confirm the clear icon appears beside the label chips, not inside the text field.
- Confirm every non-final match in a repeated label group has one working next arrow, and final matches have none.
- Confirm each arrow scrolls to the next match in its own group.
- Confirm the scan treatment covers the complete Preview area, starts immediately, stops reliably, and does not change document width.
- Check desktop and narrow layouts for clipping or overlap.
