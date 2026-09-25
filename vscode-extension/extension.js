const vscode = require("vscode");
const path = require("path");
const MD = require("./lib/mymarkdown.js");
const { mymarkdownPlugin } = require("./lib/preview-plugin.js");
const Labels = require("./lib/labels.js");
const Runner = require("./lib/label-runner.js");

/** @type {vscode.TextDocument | undefined} */
let lastMarkdownDocument;

function activeMarkdownEditor() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "markdown") return editor;
  return undefined;
}

function rememberActiveMarkdown() {
  const editor = activeMarkdownEditor();
  if (editor) lastMarkdownDocument = editor.document;
}

function currentMarkdownDocument() {
  const editor = activeMarkdownEditor();
  if (editor) {
    lastMarkdownDocument = editor.document;
    return editor.document;
  }
  if (lastMarkdownDocument && !lastMarkdownDocument.isClosed) return lastMarkdownDocument;
  return undefined;
}

function config() {
  return vscode.workspace.getConfiguration("mymarkdown");
}

/**
 * The single smallest edit that beautifies the document, or null when it is already tidy.
 * The buffer's own line ending and trailing newline are preserved, so formatting on save
 * never produces a diff on a file that had nothing to fix.
 */
function beautifyEdit(document) {
  const text = document.getText();
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  let formatted = MD.formatMarkdown(text);
  if (formatted && /\r?\n$/.test(text)) formatted += "\n";
  if (eol !== "\n") formatted = formatted.replace(/\n/g, eol);
  const edit = MD.minimalEdit(text, formatted);
  if (!edit) return null;
  const range = new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end));
  return vscode.TextEdit.replace(range, edit.text);
}

async function beautify() {
  const editor = activeMarkdownEditor();
  if (!editor) {
    vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }
  const document = editor.document;
  lastMarkdownDocument = document;
  const textEdit = beautifyEdit(document);
  if (!textEdit) {
    vscode.window.setStatusBarMessage("MyMarkdown: already beautified", 2500);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.set(document.uri, [textEdit]);
  await vscode.workspace.applyEdit(edit);
  vscode.window.setStatusBarMessage("MyMarkdown: document beautified", 2500);
}

/** @type {vscode.DiagnosticCollection | undefined} */
let diagnostics;
/** One timer per document: switching files must not cancel the pending lint of the other. */
const lintTimers = new Map();

/** Source-control diffs, output channels and other read-only views are not the user's file. */
function isEditableMarkdown(document) {
  if (!document || document.isClosed || document.languageId !== "markdown") return false;
  const scheme = document.uri && document.uri.scheme;
  return (
    scheme === undefined || scheme === "file" || scheme === "untitled" || scheme === "vscode-vfs"
  );
}

function refreshDiagnostics(document) {
  if (!diagnostics) return;
  if (!isEditableMarkdown(document)) return;
  if (!config().get("lint", true)) {
    diagnostics.delete(document.uri);
    return;
  }
  const zeroBased = (value) => Math.max(0, value - 1);
  diagnostics.set(
    document.uri,
    MD.lintMarkdown(document.getText()).map((issue) => {
      const range = new vscode.Range(
        zeroBased(issue.line),
        zeroBased(issue.column),
        zeroBased(issue.endLine),
        zeroBased(issue.endColumn),
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        issue.message,
        issue.kind === "fix"
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = "MyMarkdown";
      return diagnostic;
    }),
  );
}

/** Linting every keystroke is wasted work on a large file; let it settle first. */
function scheduleDiagnostics(document) {
  const key = document.uri.toString();
  clearTimeout(lintTimers.get(key));
  lintTimers.set(
    key,
    setTimeout(() => {
      lintTimers.delete(key);
      refreshDiagnostics(document);
    }, 300),
  );
}

/** One timer per document, mirroring scheduleDiagnostics above. */
const labelTimers = new Map();

/**
 * Re-anchor and redraw labels after an edit settles, rather than the instant the cache is
 * invalidated. Until this fires, activeLensFor keeps serving the stale cached lens at its
 * old position — a briefly-stale bar beats the bars vanishing on every keystroke.
 */
function scheduleLabelRefresh(document) {
  const key = document.uri.toString();
  clearTimeout(labelTimers.get(key));
  labelTimers.set(
    key,
    setTimeout(() => {
      labelTimers.delete(key);
      void refreshLabels(document);
    }, 300),
  );
}

/* ---------------------------------------------------------------------------
 * Labels
 *
 * A sidecar file per document holds named lenses; one is active at a time and is
 * handed to the preview script through the markdown-it plugin. Generating a lens
 * asks whatever model the user already has: VS Code's Language Model API when a
 * provider is installed, otherwise a command they configure.
 * ------------------------------------------------------------------------ */

/** Active lens name per document, for this session only. */
const activeLens = new Map();
/** Sidecar contents, keyed by document, refreshed when the file changes on disk. */
const lensCache = new Map();

function storageFolder() {
  return String(config().get("labels.storagePath", ".mymd")) || ".mymd";
}

/** @type {vscode.FileSystemWatcher | undefined} */
let sidecarWatcher;

/**
 * Watch the sidecar folder, so labels written outside the extension (by the authoring
 * skill, a coding agent, git, another window) reach the preview without the document
 * having to change first. The cache is otherwise keyed by document version, which a
 * sidecar write never bumps.
 */
function watchSidecars() {
  sidecarWatcher?.dispose();
  // The setting as a glob: sidecarUri's Uri.joinPath already copes with "./labels",
  // "labels/" or "." on the file side, so normalise the same way here and escape glob
  // characters, or the watcher silently matches nothing.
  const folder = storageFolder()
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".")
    .map((part) => part.replace(/[[\]{}*?]/g, "[$&]"))
    .join("/");
  // The folder itself as well as the files in it: VS Code reports deleting the whole
  // folder, and often creating a new subfolder with a sidecar in it, as one folder event.
  // ponytail: one glob covers every workspace folder; it also matches same-named folders
  // deeper in a tree, which reloadSidecar ignores because no open document maps there.
  sidecarWatcher = vscode.workspace.createFileSystemWatcher(folder ? `**/${folder}/**` : "**/*.json");
  sidecarWatcher.onDidCreate(reloadSidecar);
  sidecarWatcher.onDidChange(reloadSidecar);
  sidecarWatcher.onDidDelete(reloadSidecar);
}

/** A URI as a comparable key; macOS and Windows file systems ignore case. */
function uriKey(uri) {
  const key = uri.toString();
  return process.platform === "linux" ? key : key.toLowerCase();
}

/** Send a document's lenses back to disk, drawing the old ones until the reread lands. */
function rereadSidecar(document) {
  // Keeping the entry (rather than deleting it) means a writer that fires several events
  // for one save does not make the bars flicker off in between.
  const entry = lensCache.get(document.uri.toString());
  if (entry) entry.version = undefined;
  scheduleLabelRefresh(document);
}

/** Reread a changed sidecar, or every sidecar under a changed folder, for the open documents. */
function reloadSidecar(uri) {
  const changed = uriKey(uri);
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== "markdown") continue;
    const sidecar = sidecarUri(document);
    if (!sidecar) continue;
    const key = uriKey(sidecar);
    if (key === changed || key.startsWith(changed + "/")) rereadSidecar(document);
  }
}

/** Where a document's sidecar lives: one hidden folder mirroring the workspace tree. */
function sidecarUri(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return undefined;
  const relative = path.relative(folder.uri.fsPath, document.uri.fsPath);
  if (relative.startsWith("..")) return undefined;
  return vscode.Uri.joinPath(folder.uri, ...Labels.sidecarPath(relative, storageFolder()).split("/"));
}

async function readSidecar(document) {
  const uri = sidecarUri(document);
  if (!uri) return null;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    // No sidecar, or one we cannot parse: the document simply has no labels.
    return null;
  }
}

async function writeSidecar(document, lenses) {
  const uri = sidecarUri(document);
  if (!uri) {
    vscode.window.showWarningMessage("MyMarkdown: labels need the file to be inside a workspace folder.");
    return false;
  }
  // Feed writeLabels the already re-anchored lenses, not the raw file: the raw file's
  // ranges may no longer point at the right lines, and writing them straight back out
  // would stamp a fresh hash over positions that were never corrected.
  const existing = { lenses: await lensesFor(document) };
  const next = Labels.writeLabels(document.getText(), lenses, existing);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(next, null, 2) + "\n", "utf8"));
  } catch (error) {
    vscode.window.showErrorMessage("MyMarkdown: could not save labels — " + (error?.message || error));
    return false;
  }
  lensCache.delete(document.uri.toString());
  return true;
}

/** Every lens for a document, re-anchored against its current text. */
async function lensesFor(document) {
  const key = document.uri.toString();
  const cached = lensCache.get(key);
  if (cached && cached.version === document.version) return cached.lenses;
  const raw = await readSidecar(document);
  const { lenses } = Labels.readLabels(raw, document.getText());
  lensCache.set(key, { version: document.version, lenses });
  return lenses;
}

/**
 * The lens the preview should draw. Synchronous because markdown-it renders synchronously,
 * so it reads whatever the last refresh cached rather than going to disk mid-render.
 */
function activeLensFor(uri) {
  if (!config().get("labels.enabled", true)) return null;
  const key = uri.toString();
  const entry = lensCache.get(key);
  if (!entry || !entry.lenses.length) return null;
  const wanted = activeLens.get(key);
  // "" is the deliberate "hide labels" choice, not "no preference" — it must not fall
  // through to showing the first lens anyway.
  if (wanted === "") return null;
  const lens = wanted ? entry.lenses.find((item) => item.name === wanted) : entry.lenses[0];
  return lens || null;
}

/** Documents whose labels are being read because a preview asked for them first. */
const loadingForPreview = new Set();

/**
 * A preview can render a document before any editor for it has been active (VS Code
 * restoring a preview on startup, a preview opened on its own), and the cache is otherwise
 * only filled from the active editor. Read the labels now and render again if there are any.
 */
async function loadForPreview(uri) {
  const key = uri.toString();
  if (loadingForPreview.has(key)) return;
  loadingForPreview.add(key);
  try {
    const document =
      vscode.workspace.textDocuments.find((open) => open.uri.toString() === key) ||
      (await vscode.workspace.openTextDocument(uri));
    // With no editor to go on, the status bar and label commands follow the preview.
    if (!activeMarkdownEditor() && !currentMarkdownDocument()) lastMarkdownDocument = document;
    const lenses = await lensesFor(document);
    refreshLabelStatus();
    if (lenses.length) await vscode.commands.executeCommand("markdown.preview.refresh").then(undefined, () => {});
  } catch {
    // Nothing readable behind this preview: it simply shows no labels.
  } finally {
    loadingForPreview.delete(key);
  }
}

function labelPayloadFor(uri) {
  if (!config().get("labels.enabled", true)) return null;
  const key = uri.toString();
  const entry = lensCache.get(key);
  if (!entry) {
    void loadForPreview(uri);
    return null;
  }
  if (!entry.lenses.length) return null;
  if (activeLens.get(key) === "") return null;
  const lens = activeLensFor(uri);
  return { active: lens ? lens.name : "", lenses: entry.lenses };
}

let labelStatus;

function refreshLabelStatus() {
  if (!labelStatus) return;
  const document = currentMarkdownDocument();
  if (!document || !config().get("labels.enabled", true)) {
    labelStatus.hide();
    return;
  }
  const entry = lensCache.get(document.uri.toString());
  const count = entry ? entry.lenses.length : 0;
  if (!count) {
    labelStatus.text = "$(tag) Label";
    labelStatus.tooltip = "Generate MyMarkdown labels for this document";
  } else {
    const lens = activeLensFor(document.uri);
    labelStatus.text = "$(tag) " + (lens ? lens.name : "Labels off");
    labelStatus.tooltip = count + (count === 1 ? " lens" : " lenses") + " available";
  }
  labelStatus.show();
}

/**
 * Identifies everything the preview embeds for a document (the active lens and every other
 * one its dropdown offers), or null for nothing.
 */
function activeLensSignature(document) {
  const payload = labelPayloadFor(document.uri);
  return payload ? document.uri.toString() + "|" + JSON.stringify(payload) : null;
}

/** The signature last seen when the preview was told to refresh for labels. */
let lastActiveLensSignature;

async function refreshLabels(document) {
  if (!document) return;
  await lensesFor(document);
  refreshLabelStatus();
  const signature = activeLensSignature(document);
  if (signature === lastActiveLensSignature) return;
  lastActiveLensSignature = signature;
  // The lens is embedded during rendering, so the preview has to render again to pick it up.
  // Only worth doing when what it would draw actually changed — this runs on every tab
  // switch, and clearing VS Code's whole markdown token cache for no reason is not free.
  await vscode.commands.executeCommand("markdown.preview.refresh").then(undefined, () => {});
}

/* ---- talking to a model ---- */

/** The instruction text, copied from the website by sync.js. */
function instructions() {
  // Required at call time so a missing generated file cannot stop the extension loading.
  return require("./lib/ai-instructions.js");
}

async function askLanguageModel(prompt, token) {
  const models = await vscode.lm.selectChatModels({});
  if (!models.length) return null;
  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const response = await models[0].sendRequest(messages, {}, token);
  let text = "";
  for await (const fragment of response.text) text += fragment;
  return text;
}

function askCli(prompt, token) {
  const command = String(config().get("labels.cliCommand", "")).trim();
  if (!command) return Promise.resolve(null);
  const { spawn } = require("child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true });
    let out = "";
    let err = "";
    const cancel = token?.onCancellationRequested(() => child.kill());
    // A command that exits without draining stdin would otherwise throw an uncaught EPIPE
    // past the extension host's own error handling.
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      cancel?.dispose();
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(prompt);
  });
}

/**
 * Ask the user's own model. Prefers the Language Model API, which needs no key from us,
 * and falls back to a configured command for anyone without a model provider installed.
 */
async function ask(prompt, token) {
  const preference = String(config().get("labels.provider", "auto"));
  const wantsLm = preference === "auto" || preference === "languageModel";
  const wantsCli = preference === "auto" || preference === "cli";
  // Recorded rather than thrown when auto mode still has the CLI left to try - but if that
  // also comes up empty, this is the only clue to why the language model attempt failed,
  // and silently dropping it is what makes "I do have Copilot" reports impossible to debug.
  let lmReason;

  if (wantsLm && vscode.lm && typeof vscode.lm.selectChatModels === "function") {
    try {
      const reply = await askLanguageModel(prompt, token);
      if (reply) return reply;
      lmReason = "no chat model is installed or authorized in this window";
    } catch (error) {
      if (!wantsCli) throw error;
      lmReason = error?.message || String(error);
    }
  }
  if (wantsCli) {
    const reply = await askCli(prompt, token);
    if (reply) return reply;
  }
  throw new Error(
    "No AI provider available" +
      (lmReason ? " (" + lmReason + ")" : "") +
      ". Install a language model extension, or set mymarkdown.labels.cliCommand.",
  );
}

function withProgress(title, work) {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (_progress, token) => work(token),
  );
}

async function suggestLenses() {
  const editor = activeMarkdownEditor();
  if (!editor) {
    vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }
  const document = editor.document;
  let questions = [];
  try {
    questions = await withProgress("MyMarkdown: reading the document…", async (token) => {
      const reply = await ask(
        Runner.suggestionPrompt(instructions().suggestionInstructions, document.getText()),
        token,
      );
      return Runner.parseSuggestions(reply);
    });
  } catch (error) {
    vscode.window.showErrorMessage("MyMarkdown: " + (error?.message || "the AI could not answer."));
    return;
  }
  if (!questions.length) {
    vscode.window.showInformationMessage("MyMarkdown: no useful labels were suggested.");
    return;
  }
  const picked = await vscode.window.showQuickPick(questions, {
    title: "MyMarkdown: label this document by…",
    placeHolder: "Pick a question to label the document with",
  });
  if (picked) await labelDocument(picked);
}

async function labelDocument(question) {
  const editor = activeMarkdownEditor();
  if (!editor) {
    vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }
  const document = editor.document;
  const ask_ =
    question ??
    (await vscode.window.showInputBox({
      title: "MyMarkdown: label this document",
      prompt: "What should the labels show? For example: how does this content break down?",
      placeHolder: "What to find…",
    }));
  if (!ask_) return;

  let ranges = [];
  try {
    ranges = await withProgress("MyMarkdown: labelling the document…", async (token) => {
      const reply = await ask(
        Runner.labelPrompt(instructions().labelInstructions, document.getText(), ask_),
        token,
      );
      return Runner.parseRanges(reply);
    });
  } catch (error) {
    vscode.window.showErrorMessage("MyMarkdown: " + (error?.message || "the AI could not answer."));
    return;
  }

  const lens = {
    name: ask_,
    generatedBy: "on-demand",
    generatedAt: new Date().toISOString(),
    ranges,
  };
  if (!Labels.readLabels({ lenses: [lens] }, document.getText()).lenses.length) {
    vscode.window.showInformationMessage("MyMarkdown: nothing in this document matched.");
    return;
  }
  if (!(await writeSidecar(document, [lens]))) return;
  activeLens.set(document.uri.toString(), ask_);
  await refreshLabels(document);
}

/** Whether the labels feature is on at all, across every document. */
function labelsEnabled() {
  return config().get("labels.enabled", true);
}

/** Flips the global on/off switch. Reachable from the Command Palette even once the
 * status bar item (which hides itself while disabled) is gone, so there is always a way
 * back in. */
async function toggleLabelsEnabled() {
  const next = !labelsEnabled();
  await vscode.workspace
    .getConfiguration("mymarkdown")
    .update("labels.enabled", next, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    next
      ? "MyMarkdown: labels enabled."
      : 'MyMarkdown: labels disabled everywhere. Run "MyMarkdown: Switch Label Lens" to turn them back on.',
  );
  refreshLabelStatus();
  const document = currentMarkdownDocument();
  if (document) await refreshLabels(document);
}

/**
 * Copy the label hook and skill into a workspace folder, so coding agents working there
 * label the Markdown they write. The same install as `npx mymarkdown-hooks init`.
 */
async function installAgentHooks() {
  const folders = (vscode.workspace.workspaceFolders || []).filter((folder) => folder.uri.scheme === "file");
  if (!folders.length) {
    vscode.window.showWarningMessage("MyMarkdown: open a project folder first; the hooks are installed into it.");
    return;
  }
  const picked =
    folders.length === 1
      ? { folder: folders[0] }
      : await vscode.window.showQuickPick(
          folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
          { placeHolder: "Install the label hooks into which folder?" },
        );
  if (!picked) return;
  const { folder } = picked;

  // Required at call time, like the AI instructions: a packaging slip here must not stop
  // the rest of the extension loading.
  const Hooks = require("./agent-hooks/install.js");
  let results;
  try {
    results = Hooks.installAgentHooks(folder.uri.fsPath);
    const differing = results.filter((result) => result.status === "differs");
    if (differing.length) {
      const replace = await vscode.window.showWarningMessage(
        `MyMarkdown: ${differing.map((result) => result.file).join(", ")} in ${folder.name} ` +
          "differ from this version (you may have edited them, or they are from an older release). Replace them?",
        { modal: true },
        "Replace",
      );
      if (replace === "Replace") results = Hooks.installAgentHooks(folder.uri.fsPath, { force: true });
    }
  } catch (error) {
    vscode.window.showErrorMessage("MyMarkdown: could not install the label hooks — " + (error?.message || error));
    return;
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  const broken = results.filter((result) => result.status === "invalid" || result.status === "failed");
  if (broken.length) {
    vscode.window.showWarningMessage(
      "MyMarkdown: could not update " +
        broken.map((result) => `${result.file} (${result.reason})`).join(", ") +
        ". Fix it and run this command again.",
    );
  }
  const changed = count("created") + count("merged") + count("updated");
  if (!changed) {
    if (!broken.length && !count("differs")) {
      vscode.window.showInformationMessage(`MyMarkdown: the label hooks in ${folder.name} are already up to date.`);
    }
    return;
  }
  const kept = count("differs") ? ` ${count("differs")} that differ were left as they are.` : "";
  vscode.window.showInformationMessage(
    `MyMarkdown: label hooks installed in ${folder.name}.${kept} New Claude Code, Copilot and Cursor ` +
      "sessions there pick them up; Codex asks you to approve the hook once, in /hooks.",
  );
}

/** Shared by the standalone remove command and the picker inside switchLens. */
async function pickAndDeleteLens(document, lenses) {
  const picked = await vscode.window.showQuickPick(
    lenses.map((lens) => lens.name),
    { title: "MyMarkdown: remove which lens?" },
  );
  if (!picked) return false;
  const kept = lenses.filter((lens) => lens.name !== picked);
  const uri = sidecarUri(document);
  if (!uri) return false;
  try {
    if (kept.length) {
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(
          JSON.stringify(Labels.writeLabels(document.getText(), kept, null), null, 2) + "\n",
          "utf8",
        ),
      );
    } else {
      await vscode.workspace.fs.delete(uri);
    }
  } catch (error) {
    vscode.window.showErrorMessage("MyMarkdown: " + (error?.message || "could not remove the lens."));
    return false;
  }
  lensCache.delete(document.uri.toString());
  if (activeLens.get(document.uri.toString()) === picked) activeLens.delete(document.uri.toString());
  await refreshLabels(document);
  return true;
}

async function switchLens() {
  const document = currentMarkdownDocument();
  if (!document) {
    vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }
  const lenses = await lensesFor(document);
  if (!lenses.length) {
    await suggestLenses();
    return;
  }
  const items = lenses.map((lens) => ({
    label: lens.name,
    description: lens.ranges.length + (lens.ranges.length === 1 ? " range" : " ranges"),
    detail: lens.generatedBy === "skill" ? "Written while the document was authored" : undefined,
  }));
  const DELETE = "$(trash) Delete a lens…";
  const TOGGLE = labelsEnabled() ? "$(circle-slash) Disable labels completely" : "$(check) Enable labels";
  const picked = await vscode.window.showQuickPick(
    [...items, { label: "Hide labels" }, { label: DELETE }, { label: TOGGLE }],
    { title: "MyMarkdown: label lens" },
  );
  if (!picked) return;
  if (picked.label === DELETE) {
    await pickAndDeleteLens(document, lenses);
    return;
  }
  if (picked.label === TOGGLE) {
    await toggleLabelsEnabled();
    return;
  }
  if (picked.label === "Hide labels") activeLens.set(document.uri.toString(), "");
  else activeLens.set(document.uri.toString(), picked.label);
  await refreshLabels(document);
}

async function removeLens() {
  const document = currentMarkdownDocument();
  if (!document) return;
  const lenses = await lensesFor(document);
  if (!lenses.length) {
    vscode.window.showInformationMessage("MyMarkdown: this document has no labels.");
    return;
  }
  await pickAndDeleteLens(document, lenses);
}

class HeadingItem extends vscode.TreeItem {
  constructor(heading, number) {
    super(
      heading.level === 1 ? `${number}. ${heading.title}` : heading.title,
      vscode.TreeItemCollapsibleState.None,
    );
    this.description = `H${heading.level}`;
    this.tooltip = `${heading.title} (line ${heading.line})`;
    this.iconPath = new vscode.ThemeIcon(
      heading.level === 1 ? "symbol-class" : heading.level === 2 ? "symbol-method" : "symbol-field",
      new vscode.ThemeColor(
        heading.level === 1
          ? "symbolIcon.classForeground"
          : heading.level === 2
            ? "symbolIcon.methodForeground"
            : "symbolIcon.fieldForeground",
      ),
    );
    this.command = {
      command: "mymarkdown.revealLine",
      title: "Reveal Heading",
      arguments: [heading.line],
    };
  }
}

class TocProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }
  refresh() {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    const document = currentMarkdownDocument();
    if (!document) return [];
    const promoted = MD.promoteInlineJsonToFences(document.getText());
    const headings = MD.getTocHeadings(promoted);
    let h1 = 0;
    return headings.map((heading) => {
      if (heading.level === 1) h1 += 1;
      return new HeadingItem(heading, h1);
    });
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const tocProvider = new TocProvider();
  diagnostics = vscode.languages.createDiagnosticCollection("mymarkdown");

  labelStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  labelStatus.command = "mymarkdown.switchLens";

  context.subscriptions.push(
    diagnostics,
    labelStatus,
    vscode.window.registerTreeDataProvider("mymarkdown.toc", tocProvider),
    vscode.commands.registerCommand("mymarkdown.beautify", () => beautify()),
    vscode.commands.registerCommand("mymarkdown.suggestLabels", () => suggestLenses()),
    vscode.commands.registerCommand("mymarkdown.labelDocument", () => labelDocument()),
    vscode.commands.registerCommand("mymarkdown.switchLens", () => switchLens()),
    vscode.commands.registerCommand("mymarkdown.removeLens", () => removeLens()),
    vscode.commands.registerCommand("mymarkdown.toggleLabels", () => toggleLabelsEnabled()),
    vscode.commands.registerCommand("mymarkdown.installAgentHooks", () => installAgentHooks()),
    vscode.commands.registerCommand("mymarkdown.revealLine", (line) => {
      const editor = activeMarkdownEditor();
      if (!editor) return;
      const position = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === currentMarkdownDocument()) {
        tocProvider.refresh();
        scheduleDiagnostics(event.document);
        scheduleLabelRefresh(event.document);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      rememberActiveMarkdown();
      tocProvider.refresh();
      refreshDiagnostics(currentMarkdownDocument());
      // Reread from disk rather than trust the cache: the watcher misses rewrites inside a
      // sidecar subfolder created after VS Code started watching, and switching to a tab is
      // when its labels are about to be looked at. Straight away, not on the edit timer,
      // which would fire for tabs already left behind when switching quickly.
      const document = currentMarkdownDocument();
      const entry = document && lensCache.get(document.uri.toString());
      if (entry) entry.version = undefined;
      void refreshLabels(document);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => refreshDiagnostics(document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimeout(lintTimers.get(document.uri.toString()));
      lintTimers.delete(document.uri.toString());
      clearTimeout(labelTimers.get(document.uri.toString()));
      labelTimers.delete(document.uri.toString());
      diagnostics?.delete(document.uri);
      lensCache.delete(document.uri.toString());
      activeLens.delete(document.uri.toString());
    }),
    {
      dispose: () => {
        for (const timer of lintTimers.values()) clearTimeout(timer);
        lintTimers.clear();
        for (const timer of labelTimers.values()) clearTimeout(timer);
        labelTimers.clear();
        diagnostics = undefined;
        lensCache.clear();
        activeLens.clear();
        labelStatus = undefined;
        sidecarWatcher?.dispose();
        sidecarWatcher = undefined;
      },
    },
  );
  watchSidecars();

  // Off by default: a second Markdown formatter would stop VS Code choosing one at all,
  // silently breaking format on save for anyone already using Prettier or markdownlint.
  // Registered and disposed as the setting changes, so it needs no window reload.
  /** @type {vscode.Disposable | undefined} */
  let formatterRegistration;
  const syncFormatter = () => {
    const wanted = config().get("registerFormatter", false);
    if (wanted && !formatterRegistration) {
      formatterRegistration = vscode.languages.registerDocumentFormattingEditProvider("markdown", {
        provideDocumentFormattingEdits(document) {
          const edit = beautifyEdit(document);
          return edit ? [edit] : [];
        },
      });
    } else if (!wanted && formatterRegistration) {
      formatterRegistration.dispose();
      formatterRegistration = undefined;
    }
  };
  syncFormatter();

  context.subscriptions.push(
    {
      dispose: () => {
        if (formatterRegistration) formatterRegistration.dispose();
        formatterRegistration = undefined;
      },
    },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("mymarkdown.registerFormatter")) syncFormatter();
      if (event.affectsConfiguration("mymarkdown.lint")) {
        // The setting is only read while publishing, so every open document has to be
        // revisited: otherwise turning it off leaves stale problems everywhere but here.
        if (diagnostics) diagnostics.clear();
        for (const document of vscode.workspace.textDocuments) refreshDiagnostics(document);
      }
      if (event.affectsConfiguration("mymarkdown.labels.storagePath")) {
        // Every cached lens came from the old folder, and the watcher is still pointed at it.
        watchSidecars();
        for (const document of vscode.workspace.textDocuments) {
          if (document.languageId === "markdown") rereadSidecar(document);
        }
      }
    }),
  );

  refreshDiagnostics(currentMarkdownDocument());

  // VS Code renders the preview with its own markdown-it; this is where MyMarkdown's
  // JSON colouring, loose-JSON promotion and task lists are added to it.
  void refreshLabels(currentMarkdownDocument());

  return { extendMarkdownIt: (md) => mymarkdownPlugin(md, { readLens: labelPayloadFor }) };
}

function deactivate() {}

module.exports = { activate, deactivate };
