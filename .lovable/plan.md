# Dark mode color check

## What I found

**The website is always light.** Nothing in the app ever switches to the dark palette, so visitors always see the light design regardless of their system setting. No problem there today.

**The VS Code / Cursor preview does follow the system theme**, and there the colors are a problem. When the editor is in dark mode the background becomes almost black, but the headings and JSON colors stay exactly the same as in light mode:

- Heading 1 blue, heading 2 green, heading 3 orange-brown
- JSON field names purple-blue, text green, numbers orange-brown, true/false pink

Those tones were picked to sit on a light background. On near-black they turn muddy and hard to read — the orange-brown heading 3 and the numbers are the worst, and the blockquote tint is nearly invisible.

## Proposed fix

Give the dark theme its own brighter versions of the same colors, so the identity stays (blue / green / orange / purple) but everything is comfortably readable on a dark background:

- Lift each heading and JSON color to a lighter, softer tone made for dark backgrounds
- Strengthen the blockquote tint and borders so blocks still read as blocks
- Keep light mode exactly as it is today

Then re-package the extension so the new colors ship, and keep the one-command sync working so the site and extension stay aligned.

Optionally I can also prepare the website's dark palette properly, so if a dark mode is ever turned on it looks right — but it changes nothing visible today.

## Technical notes

- `vscode-extension/media/preview.css`: the `@media (prefers-color-scheme: dark)` block inside the synced `MYMARKDOWN:TOKENS-DARK` markers repeats the light values for `--mm-h1/h2/h3`, `--mm-key/string/number/literal` and `--mm-quote-bg`. Replace with dark-tuned values targeting roughly 7:1 contrast on `#020618`.
- `src/styles.css`: the `.dark` block omits `--heading-one/two/three`, `--code-key/string/number/literal`, `--glass`, `--glass-strong`, so they fall through to the light `:root` values. Add dark counterparts (optional item above).
- Keep the sync script's palette extraction in step: dark token values must live inside the marked region so `npm run extension` keeps reproducing them.
- Re-run `npm run extension` to bump the version and produce a new `.vsix`.
