# AI Label Bar

## Goal
Replace the current AI field and label controls with one compact, fixed bar at the bottom of the screen. The bar always stays on one row and changes between three clear states without reducing the document’s reading width.

## Build

### 1. Default state
- Show a small AI mark, a short `Ask AI to label…` field, an arrow submit control, and `Suggest labels` in one row.
- Submitting typed text runs the existing document-labeling flow and scan animation.
- `Suggest labels` makes a separate AI request that examines the current Markdown and returns 3–5 short, document-specific labeling ideas.
- Pasting or editing Markdown never starts AI work automatically.

### 2. Suggestion state
- Replace the default controls in the same bar with the returned suggestion chips and a close control.
- Clicking one suggestion immediately runs labeling for that suggestion, reusing the existing scan animation.
- Closing suggestions returns to the default field without changing the document.
- Surface AI errors inside the compact bar and keep the user’s input available.

### 3. Applied-label state
- Replace the bar contents with colored label chips, each showing its match count, followed by `Suggest labels` and a close control.
- Use the exact colors of the matching document markers.
- Clicking a chip toggles that label’s markers on or off; hidden chips remain visibly muted and can be restored.
- `Suggest labels` replaces this row with fresh document-specific suggestions.
- Close clears all applied labels and returns to the default state.

### 4. Layout and interaction
- Remove the current AI field from the document header and remove the current chip row from inside the preview.
- Keep Edit/Preview controls in the document header.
- Fix the AI bar to the bottom viewport edge, centered to the page width, with enough page-bottom space so it never covers document content.
- Keep it to one row at every width; on narrow screens, preserve control sizes and allow quiet horizontal scrolling rather than wrapping.
- Keep the existing right-edge colored ranges, labels, next-match arrows, strict non-overlap enforcement, and full-width reading area.
- Continue switching to Preview before an analysis and keep duplicate actions disabled while AI is working.

## AI instructions and response safety
- Extend `AI_INSTRUCTIONS.md` so it remains the single readable source for both operations: range labeling and label suggestions.
- Document both exact JSON response shapes there.
- Extend the server request with an explicit operation mode and strict schemas:
  - Labeling: `{ "items": [{ "label", "color", "startLine", "endLine" }] }`
  - Suggestions: `{ "suggestions": ["…"] }`
- Sanitize suggestions to 3–5 unique, concise values, while retaining the existing line clamping, color validation, and non-overlap enforcement for applied ranges.
- Keep the Gemini key server-only and continue using `gemini-3.8-flash`.

## Verification
- Confirm no AI request runs after paste or ordinary edits.
- Confirm the bar transitions correctly: default → suggestions → applied labels → default.
- Confirm suggestion selection labels the document immediately.
- Confirm chip toggles affect only their own markers and match counts stay correct.
- Confirm no source line belongs to more than one range.
- Confirm the bar remains one row on desktop and phone widths without covering content.
- Run real Gemini calls for both suggestion and labeling operations and verify returned errors remain visible.
