# Handover: AI label lenses for the VS Code extension

**Status update (2026-09-18):** all 9 blockers and the clearly-scoped majors below are now
fixed and covered by `node vscode-extension/check.js` (43 passed, up from 38). Two majors
are deliberately left open — see "Still open" below. Still uncommitted, still on `main`.
Still not packaged/PR'd — do that as its own step (`sync.js`, feature branch, commit, PR).

Fixed, with a regression test in `check.js` where the file is `require`-able from Node
(everything in `lib/`; `media/labels.js` is browser-only and was fixed by inspection only):

1. **Anchoring precision** (`lib/labels.js`) — `locateRange` now scores every candidate
   whose closing line also matches by how close it lands to what the range's own span
   predicts (`endDrift`, then `startDrift`), and drops on a genuine tie instead of picking
   nearest-by-old-position. `reanchorRanges` also now clips a grown range back to its next
   sibling's start instead of letting `sanitizeRanges`' overlap pass delete the sibling.
   Tests: "a moved end-anchor line does not swell a range...", "a range anchored on a
   repeated heading follows its own distinct body", "two candidates the document cannot
   tell apart are dropped, not guessed".
2. **Lens marker never emitted in real VS Code** (`lib/preview-plugin.js`) — replaced the
   `md.core.ruler.push` core rule (which ran during `parse()`, where `env.currentDocument`
   is always unset in the real engine) with a wrap of `md.renderer.render`, which gets the
   env that actually carries `currentDocument`. Test rewritten to call `md.parse()` then
   `md.renderer.render()` with two different env objects, matching the real split.
3. **Off-by-one line numbers** (`media/labels.js`) — `mappedBlocks` now converts
   markdown-it's 0-based `data-line` to a 1-based source line before comparing against the
   (1-based) range. No automated test — the repo has no DOM test harness and adding one
   felt like more machinery than a one-line fix warranted; verified by inspection.
4. **`writeSidecar` corrupting existing lenses** (`extension.js`) — now feeds `writeLabels`
   the already re-anchored lenses (`{ lenses: await lensesFor(document) }`) instead of the
   raw on-disk JSON. (The `labels.js` half — stamping anchors on carried-over lenses too —
   was already done before this session; `writeLabels`'s `stamp()` helper covers both loops.)
5. **`labelDocument` could never succeed** (`extension.js`) — validates fresh ranges with
   `Labels.sanitizeRanges(ranges, document.getText().split("\n").length)` instead of routing
   brand-new, anchor-less ranges through `readLabels`'s stale/re-anchor path.
6. **Skill-written sidecar rendering empty** — same root cause as #5; already mitigated by
   `reanchorRanges`'s "a range with no stored anchor keeps its stored position" branch,
   which predates this session. Added a regression test for it directly:
   "a skill-written sidecar with no sourceHash or anchors still yields its lenses".
7. **Bars vanish on first keystroke** (`extension.js`) — `onDidChangeTextDocument` no
   longer deletes `lensCache` synchronously; it schedules a debounced `refreshLabels` (same
   300ms pattern as `scheduleDiagnostics`), and `activeLensFor` keeps serving the stale
   cached lens at its old position until that fires.
8. **"Hide labels" didn't hide labels** (`extension.js`) — `activeLensFor` now returns
   `null` when the stored preference is the empty-string sentinel, instead of falling
   through to "no preference" and showing the first lens.
9. **Attribute-escaping of the embedded lens** — verified safe (markdown-it's
   `escapeHtml` covers `& < > "`) and added a dedicated test with a label containing all of
   those plus a literal `</div>`, asserting no live element is injected and the label
   round-trips losslessly.

Majors also fixed this session: unhandled fs rejections in `writeSidecar`/`removeLens` now
show a clean error instead of crashing; `askCli` drains a stdin error instead of throwing
an uncaught EPIPE; `mymarkdown.labels.cliCommand` now has `"scope": "machine"`;
`refreshLabels` only calls `markdown.preview.refresh` when the active lens's signature
actually changed, not on every tab switch; the label layer is pushed out to
`right: -14px` and the tag is hover/focus-only (opacity 0 by default) instead of
permanently overlapping the text; `labelDocument` normalizes the typed question
(`trim().slice(0, 80)`) once, up front, so it matches what `sanitizeLens` stores.

**Still open (majors, deliberately left for a follow-up):**
- **Cross-document staleness**: `activeLensFor` still doesn't check the cached entry's
  `version` against a live document. Partially mitigated — `lensesFor` already re-derives
  on a version mismatch, and switching to a stale document's tab triggers that via
  `onDidChangeActiveTextEditor` — but there's a narrow window where the preview can render
  with the old cache before that resolves. Needs `vscode.workspace.textDocuments` lookup
  inside `activeLensFor` to close fully; skipped for now to avoid rushing a change to a
  synchronous, render-path-critical function.
- **Hook's "already labelled" guard never matches a skill-written sidecar**
  (`.claude/hooks/markdown-labels.cjs` keys on `sourceHash`, which `SKILL.md` explicitly
  tells the skill to leave out). No fix applied: making the skill compute a real hash
  needs a shell tool (`sha256sum`/`shasum`) whose availability isn't guaranteed, and
  having the hook self-heal the hash on the *next* edit would stamp the hash against the
  wrong (post-edit) text, defeating the whole point of hashing. Needs a real design
  decision, not a quick patch.

Everything below this line is the original handover, kept as the historical record of what
was analyzed and why. Some of it now describes bugs that are already fixed — see above for
what changed instead of re-deriving it from the description alone.

---

**Status: broken, do not open a PR yet.** An adversarial review found 9 blockers and 18
majors. One fix was half-applied when this handover was written. Everything below is
uncommitted, sitting in the working tree on `main` (not even a feature branch).

Delete this file once the feature is done and merged.

## What this is

Issue: https://github.com/ardeeshany/MyMarkdown/issues/3

The website has an "AI label bar": ask it a question, it colours 3-5 line ranges in the
preview gutter with short labels. It's ephemeral there — any edit clears it, because line
numbers stop matching. This brings it to the VS Code extension, where the document is
edited constantly, so the core problem to solve is **making labels survive edits**.

Design decided during brainstorming (see the conversation, or re-derive from the code):
- A sidecar file per document (`.mymd/<path>.json`) holds named **lenses**; a lens is one
  question plus the ranges that answer it. Multiple lenses coexist; one is active at a
  time, switched from a status bar item.
- Two producers write the same format: a Claude Code **skill**
  (`.claude/skills/markdown-labels/SKILL.md`), triggered by a **hook**
  (`.claude/hooks/markdown-labels.cjs`) after writing a `.md` file over ~400 words/2
  headings, and an **on-demand** extension command using `vscode.lm` with a CLI fallback
  — no API key handled by the extension either way.
- Ranges are re-anchored **by content**, not line number: each range stores the
  normalized text of its first/last line, so it can be relocated after an edit. A range
  whose text is genuinely gone drops on its own.
- Rendering: a **preview script** (`media/labels.js`) draws bars, positioned by measuring
  `data-line` VS Code already stamps. The plugin embeds the active lens as a hidden div,
  only when `env.currentDocument` is set (so `markdown.api.render` on a raw string is
  unaffected).

## Repo state right now

```
cd /mnt/fast/python_projects/MyMarkdown-fork
git status --short   # everything below is uncommitted
git branch --show-current   # "main" — put this on a feature branch before committing
```

Remotes: `origin` = `soheilrayatdoost/MyMarkdown` (your fork), `upstream` =
`ardeeshany/MyMarkdown` (the real repo, PR target). PR #2 (the previous feature — built-in
preview + region-aware rules) is already merged into `upstream/main`; this label feature
builds on top of that.

Files touched:
```
 M .gitignore                          (gitignores .mymd/)
 M vscode-extension/README.md          (documents the feature)
 M vscode-extension/check.js           (+8 checks for labels, 38 total, all currently pass)
 M vscode-extension/extension.js       (commands, status bar, sidecar read/write, ask())
 M vscode-extension/lib/preview-plugin.js  (embeds active lens — BROKEN, see below)
 M vscode-extension/media/preview.css  (bar styling — BROKEN, see below)
 M vscode-extension/package.json       (4 commands, 4 settings, labels.js preview script)
 M vscode-extension/sync.js            (copies AI_INSTRUCTIONS.md into lib/ai-instructions.js)
?? .claude/                            (the skill + hook + settings.json)
?? vscode-extension/lib/ai-instructions.js  (generated by sync.js, don't hand-edit)
?? vscode-extension/lib/label-runner.js     (prompt building, JSON extraction from model replies)
?? vscode-extension/lib/labels.js           (the sidecar format — anchoring rewrite IN PROGRESS)
?? vscode-extension/media/labels.js         (preview script that draws the bars)
```

**Important:** `git checkout -- vscode-extension/lib/mymarkdown.js` if you ever see that
file modified — running `npm run extension` / `node vscode-extension/sync.js` regenerates
it from `src/routes/index.tsx` and picks up cosmetic transpiler noise from whatever
TypeScript version is installed. That file is NOT part of this change; revert it before
committing anything.

`node vscode-extension/check.js` currently reports **38 passed**. Do not trust that
number — the adversarial review found bugs the existing checks don't cover (see below).
Add regression tests for each blocker as you fix it.

## What's broken — fix in this order

The full review output (very long, 59 sub-agents) may or may not still be readable at:
```
/tmp/claude-1000/-mnt-fast-python-projects-Neuro-X/5ff76276-d332-4ef9-a8f5-dfe4a5111628/tasks/wced3zlti.output
```
Treat it as gone and work from the summaries below if it's not there. `/tmp` may have
been cleared since.

### 1. IN PROGRESS — anchoring gives wrong-but-confident matches (lib/labels.js)

**This is the fix that was half-applied.** The unapplied script is pasted in full at the
bottom of this file (`### Script: fix-locate.js`) in case `/tmp` is gone. To check whether
it's already applied: `grep -c endDrift vscode-extension/lib/labels.js` — 0 means not
applied yet, apply it.

The bug: the original `findAnchor` picked whichever line matched an anchor text nearest
to the *old* position, with no check that it was actually the same section. Two concrete
failures the review found:

- **Repeated headings** (`## Notes` six times in one doc): re-anchors onto the *wrong*
  copy 14% of the time in a 4000-doc fuzz run — wrong far more often than dropped (36
  times). That inverts the intended safety property ("drop rather than mislabel").
- **A moved end-anchor line** can make one range's end search find a copy of its closing
  text far away, swallowing every other range in the lens (the sanitizer's overlap-removal
  then deletes the swallowed ones).
- **Table rows sharing a 60-char prefix** (`ANCHOR_LENGTH` was 60) all hash to the same
  anchor, so re-anchoring picks the wrong row.

The fix in `fix-locate.js` (not yet applied): score every candidate start position by how
close its *end* anchor lands to where the range's own span predicts, pick the
unambiguous winner, drop if two candidates tie. Also clips a range's end back to its
next sibling's start after re-anchoring, instead of letting the sanitizer's overlap pass
delete the sibling outright.

**When last tested** (before the fix), 3 of 5 repro cases passed, 2 failed:
- PASS: skill-shaped sidecar (no sourceHash/anchors) yields its lenses
- PASS: table rows told apart
- PASS: carried-over lens survives an edit
- FAIL: moved end marker still swallows the lens (`got [["a",1,7]]`, wanted separate a/b/c)
- FAIL: repeated heading test itself had a bug in the *test* (wrong expected line) as well
  as a real remaining issue — re-derive the expected value carefully before trusting it

Apply the script, then re-run gets you most of the way; expect to still need to debug the
two failing cases by hand.

### 2. BLOCKER — the lens marker is never emitted in real VS Code (lib/preview-plugin.js)

The single most important blocker. `embedActiveLens` runs as a markdown-it **core rule**,
which fires during `md.parse()`. But VS Code's real `MarkdownItEngine` calls `parse()`
with `env.currentDocument` always `undefined` — `currentDocument` is only set in the
*separate* env object passed to `renderer.render()` afterward. Verified against the
installed `markdown-language-features/dist/extension.js`:
```
#a(t,n){let r={currentDocument:void 0, ...}; return n.parse(t,r)}
async render(t,n){ ... a={currentDocument: typeof t=="string"?void 0:t.uri, ...};
  return {html: i.renderer.render(o, {...i.options,...r}, a), ...}}
```
`check.js`'s own test passes only because it calls `md.render()` (which internally does
both parse+render with the *same* env), so it never exercises the real split.

**Fix:** don't use a core rule. Wrap the renderer instead:
```js
const baseRender = md.renderer.render.bind(md.renderer);
md.renderer.render = (tokens, options, env) => baseRender(tokens, options, env) + markerHtml(env, readLens, escapeHtml);
```
where `markerHtml` returns `""` when `env.currentDocument` is unset. Delete the
`md.core.ruler.push("mymarkdown_labels", ...)` line and the `state`-based
`embedActiveLens` function; replace with a render-time version.
**Also fix `check.js`'s test** for this — drive `md.parse(src, parseEnv)` then
`md.renderer.render(tokens, md.options, renderEnv)` with two different env objects, so it
can't silently pass again against a host that produces nothing.

### 3. BLOCKER — off-by-one line numbers in the preview script (media/labels.js)

`mappedBlocks()` reads `data-line` directly — that's markdown-it's `token.map[0]`, which
is **0-based**. Every line number in the sidecar format is **1-based**
(`numberLines`, `sanitizeRanges` clamping to `[1, lineCount]`, etc). `measure()` compares
them directly with no conversion, so every bar is drawn one line low, and a range
covering line 1 is silently dropped entirely (block.end for the first element is negative
relative to a 1-based range start).

**Fix:** in `mappedBlocks`, `var start = Number(node.getAttribute("data-line")) + 1;`
(keep `block.end = start + span` as-is, using the now-corrected `start`). Add a check
asserting a `{startLine:1, endLine:1}` range produces a bar aligned with the very first
block.

### 4. BLOCKER — writeSidecar corrupts existing lenses (extension.js + labels.js interaction)

`writeSidecar` passes the **raw on-disk JSON** as `existing` into `writeLabels`.
`writeLabels`'s merge loop only ran `sanitizeLens` (clamp + dedupe) on carried-over
lenses, never `reanchorRanges` — so if the document had changed since that lens was
written, its ranges get clamped onto the *wrong* lines, and then a **fresh sourceHash for
the new text** gets written over it. Because the hash now matches, `readLabels` will
never re-anchor those ranges again — the corruption is permanent, not recoverable on next
read.

**Fix (two parts, both needed):**
- In `extension.js`, `writeSidecar`: change `const existing = await readSidecar(document);`
  to `const existing = { lenses: await lensesFor(document) };` — feed `writeLabels` the
  *already re-anchored* lenses, not the raw file. (`removeLens` already does this
  correctly, coincidentally — it's the one caller that skips `readSidecar`.)
- In `labels.js`, `writeLabels`: the anchor-stamping (`anchorsFor`) was only applied to
  the newly-passed-in `lenses`, not to `existing` ones — so even with the extension.js fix,
  a carried-over lens's ranges wouldn't get fresh anchors stamped and could still die on
  the *next* edit. Stamp both. (This may already be fixed — check for a `stamp()` helper
  used for both loops in the current `labels.js`; if `git diff` shows it, this half is
  done, only the `extension.js` half remains.)

### 5. BLOCKER — `labelDocument` can never succeed (extension.js line ~376)

The pre-flight validation
`Labels.readLabels({ lenses: [lens] }, document.getText()).lenses.length` always returns
0: the wrapper object has no `sourceHash`, so `readLabels` treats it as stale and tries to
re-anchor — but the `lens` was just built fresh from the model reply and has no
`anchor`/`endAnchor` on any range, so every range gets dropped. This means the on-demand
`MyMarkdown: Label Document...` command (and `Suggest Label Lenses`, which calls into it)
**always** shows "nothing in this document matched", regardless of what the model
returned, and never writes a sidecar.

**Fix:** validate with `Labels.sanitizeRanges(ranges, document.getText().split("\n").length).length`
instead — that doesn't route through the stale/re-anchor path at all, which is what you
actually want here (these are brand-new ranges, not ones being read back).

*(Note: fixing #1's `reanchorRanges` to skip anchor-less ranges — "keep the stored
position when a range has no anchor" — also happens to fix this and #6/#7 below as a side
effect, since it's the same root cause reached from different callers. Pick ONE approach:
either fix `reanchorRanges` to not punish anchor-less ranges, or fix each call site to
validate without going through the staleness path. Don't do both halfway.)*

### 6. BLOCKER — a skill-written sidecar always renders empty (labels.js / SKILL.md)

Same root cause as #5. `SKILL.md` explicitly tells the agent: "Leave `sourceHash` out.
The extension recomputes it" and "Do not add `anchor` or `endAnchor` either. The
extension fills those in." **Neither promise is true on the read path** — nothing
recomputes or fills anything when reading; only `writeLabels` does that, and
`writeLabels` is never called on a skill-authored file (the skill writes the JSON
directly with `Write`). So a sidecar written exactly as `SKILL.md` specifies comes back
as `{lenses: []}` from `readLabels` — the skill's entire output is silently discarded.

**Fix:** the same `reanchorRanges` guard from #1's writeup ("a range with no stored
anchor keeps its stored position") fixes this too. This is the recommended single fix
for #4/#5/#6 together — check if it's already landed as part of your anchoring work.

### 7. BLOCKER — bars vanish on the first keystroke, never come back (extension.js)

The PR's whole point is "labels survive edits" — this defeats it directly.
`onDidChangeTextDocument` does `lensCache.delete(event.document.uri.toString())` and
nothing else. `activeLensFor` is **synchronous** (called during markdown-it rendering)
and only reads `lensCache` — nothing repopulates it on a text-change event, only on
active-editor-change or after running a label command. So: open a labelled doc, bars
show; type one character; VS Code re-renders the preview; cache is empty;
`activeLensFor` returns null; bars gone. They stay gone until you switch to another
editor tab and back.

**Fix:** don't just delete the cache — schedule a debounced `refreshLabels(event.document)`
from the same handler (reuse the existing lint-debounce pattern already in the file,
`scheduleDiagnostics`/`lintTimers`). Keep the stale cached lens drawing at its old
(possibly now-wrong) position during the debounce window rather than vanishing instantly
— a briefly-stale bar beats no bar.

### 8. BLOCKER — "Hide labels" doesn't hide labels (extension.js `switchLens`/`activeLensFor`)

`switchLens`'s "Hide labels" option does `activeLens.set(uri, "")`. `activeLensFor` reads:
`const lens = wanted ? entry.lenses.find(...) : entry.lenses[0];` — empty string is
falsy, so it falls into the "no preference" branch and shows the *first* lens instead of
nothing. The `"Labels off"` status bar text is dead code — unreachable.

**Fix:** `if (wanted === "") return null;` before the ternary, or use a real sentinel
(`null`/a dedicated Set) instead of overloading falsy-string.

### 9. BLOCKER — the marker's own attribute escaping needs a dedicated test

Not confirmed broken, but flagged as the single highest-value thing to verify by hand
before merging: the lens is serialized as `JSON.stringify(lens)` into an HTML attribute
(`data-lens="..."`) via `escapeHtml`. Confirm a label containing `"`, `<`, `>`, `&`, or a
literal `</div>` can't inject markup or break out of the attribute. Write a check for it
explicitly — this is the one place untrusted content (from a model, or a hand-edited
sidecar file) reaches the rendered HTML.

## Majors worth fixing before merging (not launch-blocking on their own, but easy and real)

- **`.mymd` folder handling for `writeSidecar`/`removeLens`**: unhandled fs rejections
  (read-only FS, no workspace folder) surface as raw VS Code error toasts instead of a
  clean message — wrap in try/catch, `showErrorMessage`.
- **`askCli`**: no `stdin.on("error", ...)` before `.end(prompt)` — a CLI that exits
  without draining stdin throws an *uncaught* EPIPE that crashes past the extension host's
  own error handling. One line: `child.stdin.on("error", () => {});`.
- **`mymarkdown.labels.cliCommand` setting has no `"scope": "machine"`** — a cloned
  repo's `.vscode/settings.json` can silently choose the shell command that runs when you
  invoke a label command (it's spawned with `shell: true`). Add the scope; consider
  `capabilities.untrustedWorkspaces`.
- **`refreshLabels` always calls `markdown.preview.refresh`**, which clears VS Code's
  *entire* markdown token cache and re-renders every open preview tab — even from the
  active-editor-change handler, which fires on every tab switch regardless of whether
  labels are involved. Only call it when the active lens actually changed.
- **Label bars/tags overlap the text itself** — `.markdown-body` has no horizontal
  padding, so `right: 0` puts the 3px bar and the always-visible tag over the last few
  pixels of the text column. Push the layer out (`right: -14px`, VS Code's body has ~26px
  padding there) and make the tag hover-only (`opacity: 0` + `:hover`/`:focus-visible` —
  the README already claims "hover a bar to read its label", which isn't true yet).
- **Long/whitespace-padded typed questions never match their own lens**: `labelDocument`
  stores the raw typed string in `activeLens`, but `sanitizeLens` trims and truncates to
  80 chars when writing. Normalize once at the entry point before using the string for
  both the write and the `activeLens.set`.
- **Cross-document staleness**: `activeLensFor` doesn't check the cached entry's
  `version` against the *current* document, and the cache is only invalidated when the
  edited doc is the currently-active one — so an inactive document edited by another tool
  (find/replace across files, another extension) can show a preview with bars pointing at
  text that's since moved.
- **The hook's "already labelled" guard never matches a skill-written sidecar** (it keys
  on `sourceHash`, which skill-written sidecars don't have per `SKILL.md`'s own
  instructions) — so the hook nags to re-label the same file after every subsequent edit,
  forever. Fix alongside #6.

## After the fixes

1. `git checkout -- vscode-extension/lib/mymarkdown.js` if it's dirty (sync.js side effect).
2. `node vscode-extension/check.js` — add a regression test per blocker fixed above.
3. `git checkout -b feat/ai-label-lenses` (currently sitting on `main` — don't commit there).
4. Commit, push to `origin` (your fork), open a PR against `upstream/main` referencing
   issue #3. Be upfront in the PR body about what an adversarial review already caught —
   the maintainer merged the last PR partly because it was honest about its own bugs.
5. Re-run `node vscode-extension/sync.js --skip-pack --no-bump` once more right before
   opening the PR to confirm the generated files (`lib/ai-instructions.js`, the packaged
   `.vsix`) are in sync with your final source changes.

---

## Script: fix-locate.js (apply if not already applied)

Check first: `grep -c endDrift vscode-extension/lib/labels.js` — if this prints `0`, the
script below has NOT been applied yet. Save it as a file and `node` it from the repo
root, or apply the same logic by hand to `lib/labels.js`.

```js
const fs = require("fs");
const f = "vscode-extension/lib/labels.js";
let s = fs.readFileSync(f, "utf8");

const patch = (o, n) => {
  const c = s.split(o).length - 1;
  if (c !== 1) throw new Error(`matched ${c}: ${o.slice(0, 70)}`);
  s = s.replace(o, () => n);
};

const from = s.indexOf("function locateRange(keys, range) {");
const to = s.indexOf("/**\n * Ranges as stored");
if (from === -1 || to === -1 || to < from) throw new Error("locateRange block not found");

const replacement = `function locateRange(keys, range) {
  if (!range.anchor) return null;
  const span = Math.max(0, range.endLine - range.startLine);
  const wasAt = range.startLine - 1;

  const starts = [];
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] === range.anchor) starts.push(i);
  }
  if (!starts.length) return null;

  // Score each candidate by how nearly its closing line lands where the range's own span
  // says it should. That is what tells six identical \`## Notes\` headings apart: only the
  // right one has the right body the right distance below it.
  const candidates = [];
  for (const start of starts) {
    const expected = start + span;
    let end = expected;
    if (range.endAnchor) {
      const limit = Math.min(keys.length - 1, start + span + END_SLACK);
      let found = -1;
      for (let j = start; j <= limit; j += 1) {
        if (keys[j] === range.endAnchor) {
          found = j;
          break;
        }
      }
      if (found === -1) continue; // this copy has no closing line, so it is not the one
      end = found;
    }
    candidates.push({
      start,
      end,
      endDrift: Math.abs(end - expected),
      startDrift: Math.abs(start - wasAt),
    });
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => a.endDrift - b.endDrift || a.startDrift - b.startDrift);
  const [best, next] = candidates;
  // Two copies the document cannot tell apart either. Dropping the bar is a smaller lie
  // than drawing it confidently over the wrong one.
  if (next && next.endDrift === best.endDrift && next.startDrift === best.startDrift) return null;
  return { start: best.start, end: best.end };
}

`;

s = s.slice(0, from) + replacement + s.slice(to);

// Clip siblings rather than letting one grown range delete the rest of its lens.
patch(
  `    const found = locateRange(keys, range);
    if (!found) continue;
    moved.push({ ...range, startLine: found.start + 1, endLine: found.end + 1 });
  }
  return moved;
}`,
  `    const found = locateRange(keys, range);
    if (!found) continue;
    moved.push({ ...range, startLine: found.start + 1, endLine: found.end + 1 });
  }

  // A range whose closing line drifted can end up covering the ones after it. Trimming it
  // back to its neighbour keeps the lens intact; leaving it would let the overlap pass in
  // sanitizeRanges delete every range it now swallows.
  moved.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  for (let i = 0; i < moved.length - 1; i += 1) {
    const nextStart = moved[i + 1].startLine;
    if (moved[i].endLine >= nextStart) moved[i].endLine = Math.max(moved[i].startLine, nextStart - 1);
  }
  return moved;
}`,
);

fs.writeFileSync(f, s);
console.log("labels.js: candidate scoring + sibling clipping");
```

**After applying, these two repro cases were still FAILING and need debugging by hand**
(the other 3 of 5 repro checks passed):

```js
// Case 1: a moved end-anchor line must not swell the range and eat its neighbours.
// Last observed result: [["a",1,7]] (wanted 3 separate ranges a/b/c preserved)
const L = require("./vscode-extension/lib/labels.js");
const seven = ["a1","a2","END MARKER","b1","b2","c1","c2"].join("\n");
const file = L.writeLabels(seven, [{ name: "L", ranges: [
  { label: "a", color: "#111111", startLine: 1, endLine: 3 },
  { label: "b", color: "#222222", startLine: 4, endLine: 5 },
  { label: "c", color: "#333333", startLine: 6, endLine: 7 },
] }], null);
const movedEnd = ["a1","a2","b1","b2","c1","c2","END MARKER"].join("\n");
console.log(L.readLabels(file, movedEnd).lenses[0].ranges);

// Case 2: repeated "## Notes" headings — re-anchor by body content, not nearest twin.
// The expected line in the last test run may itself have been miscalculated — recompute
// `want` carefully (it's the index, in the SHIFTED document, of the literal line "body 2")
// before trusting a pass/fail here.
const rep = Array.from({ length: 6 }, (_, i) => ["## Notes", "body " + i, ""].join("\n")).join("\n");
const lines = rep.split("\n");
const target = lines.findIndex((l) => l === "body 2");
const f2 = L.writeLabels(rep, [{ name: "L", ranges: [
  { label: "Third", color: "#111111", startLine: target, endLine: target + 1 },
] }], null);
const shifted = "x\ny\nz\nw\n" + rep;
const want = shifted.split("\n").findIndex((l) => l === "body 2");
console.log(L.readLabels(f2, shifted).lenses[0]?.ranges?.[0], "want start:", want);
```

Given the `locateRange` scoring change above, both of these *should* now pick correctly
by end-anchor distance — if they still fail, the bug is likely in how `span`/`expected`
interacts with `sanitizeRanges`' later clamping, or in the sibling-clipping sort order.
Print `keys`, `starts`, and each candidate's `endDrift`/`startDrift` to see what's actually
being compared.
