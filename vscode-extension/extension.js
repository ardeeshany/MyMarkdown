const path = require("path");
const vscode = require("vscode");
const MD = require("./lib/mymarkdown.js");

/** @type {vscode.WebviewPanel | undefined} */
let previewPanel;
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

function getWebviewHtml(webview, extensionUri) {
  const mediaUri = (file) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", file)).toString();
  const libUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "lib", "mymarkdown.js")).toString();
  const renderUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "lib", "render.js")).toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${mediaUri("preview.css")}" />
<title>MyMarkdown Preview</title>
</head>
<body>
<div id="mm-layout">
  <aside id="mm-toc" aria-label="Table of contents">
    <button id="mm-toc-toggle" type="button" aria-expanded="true">Contents</button>
    <nav id="mm-toc-list"></nav>
  </aside>
  <main id="mm-main">
    <article id="mm-doc"></article>
    <div id="mm-lint"></div>
  </main>
</div>
<script src="${libUri}"></script>
<script src="${renderUri}"></script>
<script src="${mediaUri("preview.js")}"></script>
</body>
</html>`;
}

function panelTitle(document) {
  return "MyMarkdown: " + path.basename(document.fileName);
}

function pushPreviewUpdate() {
  if (!previewPanel) return;
  const document = currentMarkdownDocument();
  if (!document) {
    previewPanel.webview.postMessage({ type: "empty" });
    return;
  }
  previewPanel.title = panelTitle(document);
  previewPanel.webview.postMessage({ type: "update", markdown: document.getText() });
}

function matchLine(document, text, fallbackLine) {
  const needle = (text || "").trim().slice(0, 40);
  if (needle.length >= 6) {
    const lines = document.getText().replace(/\r\n/g, "\n").split("\n");
    const compact = needle.replace(/\s+/g, " ").toLowerCase();
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].replace(/\s+/g, " ").toLowerCase().includes(compact.slice(0, 24))) {
        return index + 1;
      }
    }
  }
  return fallbackLine;
}

async function revealSourceLine(line, text) {
  const document = lastMarkdownDocument && !lastMarkdownDocument.isClosed ? lastMarkdownDocument : undefined;
  if (!document) return;
  const visible = vscode.window.visibleTextEditors.find((editor) => editor.document === document);
  const editor = visible || (await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false }));
  const target = Math.max(0, Math.min(document.lineCount - 1, matchLine(document, text, line) - 1));
  const position = new vscode.Position(target, 0);
  const range = document.lineAt(target).range;
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}


function openPreview(context) {
  rememberActiveMarkdown();
  const document = currentMarkdownDocument();
  if (!document) {
    vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }
  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Beside, true);
    pushPreviewUpdate();
    return;
  }
  previewPanel = vscode.window.createWebviewPanel(
    "mymarkdown.preview",
    panelTitle(document),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media"), vscode.Uri.joinPath(context.extensionUri, "lib")] }
  );
  previewPanel.webview.html = getWebviewHtml(previewPanel.webview, context.extensionUri);
  pushPreviewUpdate();
  previewPanel.webview.onDidReceiveMessage((message) => {
    if (message && message.type === "ready") pushPreviewUpdate();
    if (message && message.type === "revealLine") revealSourceLine(message.line, message.text);
  });
  previewPanel.onDidDispose(() => {
    previewPanel = undefined;
  });
}

async function beautify() {
  const editor = activeMarkdownEditor();
  if (!editor) {
    vscode.window.showInformationMessage("Open a Markdown file first.");
    return;
  }
  const document = editor.document;
  lastMarkdownDocument = document;
  const formatted = MD.formatMarkdown(document.getText());
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, formatted);
  await vscode.workspace.applyEdit(edit);
  vscode.window.setStatusBarMessage("MyMarkdown: document beautified", 2500);
  pushPreviewUpdate();
}

class HeadingItem extends vscode.TreeItem {
  constructor(heading, number) {
    super(
      heading.level === 1 ? `${number}. ${heading.title}` : heading.title,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = `H${heading.level}`;
    this.tooltip = `${heading.title} (line ${heading.line})`;
    this.iconPath = new vscode.ThemeIcon(
      heading.level === 1 ? "symbol-class" : heading.level === 2 ? "symbol-method" : "symbol-field",
      new vscode.ThemeColor(
        heading.level === 1 ? "symbolIcon.classForeground" : heading.level === 2 ? "symbolIcon.methodForeground" : "symbolIcon.fieldForeground"
      )
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
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("mymarkdown.toc", tocProvider),
    vscode.commands.registerCommand("mymarkdown.openPreview", () => openPreview(context)),
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
        pushPreviewUpdate();
        tocProvider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      rememberActiveMarkdown();
      pushPreviewUpdate();
      tocProvider.refresh();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
