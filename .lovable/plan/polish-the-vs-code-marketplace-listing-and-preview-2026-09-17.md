# Polish the VS Code Marketplace listing and preview

## What will change
- Add a proper 128×128 MyMarkdown PNG icon to the extension package so the Marketplace thumbnail appears.
- Rewrite and reorganize the Marketplace/GitHub README for cleaner hierarchy, shorter sections, better spacing, and more readable settings information.
- Add the two supplied product screenshots that show the editor/preview experience and formatted JSON to both the packaged Marketplace README and GitHub README.
- Improve task-list checkbox contrast so checked and unchecked states are clearly distinct in light and dark themes.
- Add vertical spacing between consecutive alert boxes so their colored borders no longer touch.
- Package a new extension version and update the website download page to point to it.

## Technical details
- Store the Marketplace icon and README screenshots inside `vscode-extension/media/`, include them in the `.vsix`, and reference them with repository-hosted absolute URLs so Marketplace and GitHub can display them.
- Preserve VS Code theme compatibility and high-contrast behavior in preview CSS.
- Extend the extension checks to cover the icon, packaged README images, task checkbox states, and alert spacing.
- Run the existing one-command extension checks and package process, then inspect the resulting `.vsix` contents.
