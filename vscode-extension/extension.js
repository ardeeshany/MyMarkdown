const vscode = require("vscode");
const MD = require("./lib/mymarkdown.js");
const { mymarkdownPlugin } = require("./lib/preview-plugin.js");

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

  context.subscriptions.push(
    diagnostics,
    vscode.window.registerTreeDataProvider("mymarkdown.toc", tocProvider),
    vscode.commands.registerCommand("mymarkdown.beautify", () => beautify()),
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
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      rememberActiveMarkdown();
      tocProvider.refresh();
      refreshDiagnostics(currentMarkdownDocument());
    }),
    vscode.workspace.onDidOpenTextDocument((document) => refreshDiagnostics(document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimeout(lintTimers.get(document.uri.toString()));
      lintTimers.delete(document.uri.toString());
      diagnostics?.delete(document.uri);
    }),
    {
      dispose: () => {
        for (const timer of lintTimers.values()) clearTimeout(timer);
        lintTimers.clear();
        diagnostics = undefined;
      },
    },
  );

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
    }),
  );

  refreshDiagnostics(currentMarkdownDocument());

  // VS Code renders the preview with its own markdown-it; this is where MyMarkdown's
  // JSON colouring, loose-JSON promotion and task lists are added to it.
  return { extendMarkdownIt: (md) => mymarkdownPlugin(md) };
}

function deactivate() {}

module.exports = { activate, deactivate };
