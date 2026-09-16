# Simplify the VS Code table of contents

## Changes
- Give the contents panel more usable width and cap its height so it does not crowd the preview.
- Keep every heading on one clean line with ellipsis only when it truly overflows.
- Strengthen H1/H2/H3 hierarchy with restrained spacing and indentation, while removing the visually dense stacking.
- Keep active-heading highlighting, collapse behavior, scrolling, and click navigation unchanged.
- Rebuild the local VS Code package and update the downloadable version references.

## Technical details
- Adjust only the extension preview’s contents markup/styles and related package version references.
- Validate the extension checks and inspect the rendered panel at a narrow split-editor width.
