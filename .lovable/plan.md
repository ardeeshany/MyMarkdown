# BeautifyMD navigation and table of contents

## Changes
- Move the Edit/Preview switch from the page header into the document toolbar, aligned on the left of the Copy and Beautify actions.
- Build a table of contents from rendered H1, H2, and H3 headings.
- Keep the table of contents visible while the document scrolls on larger screens.
- Add an open/collapse control and highlight the heading currently visible in the document.
- Make each table-of-contents item scroll to its matching heading.
- Use a compact collapsible treatment on smaller screens so it does not cover the editor.

## Technical details
- Generate stable heading IDs from heading text, including duplicate-title handling.
- Use viewport observation for active-section tracking and native smooth scrolling, respecting reduced-motion preferences.
- Preserve all existing Markdown formatting, linting, copy, and beautify behavior.
- Verify desktop and mobile layouts, scrolling, active states, and browser console output.
