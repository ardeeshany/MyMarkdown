# MyMarkdown labels

Have coding agents label the Markdown they write, for the
[MyMarkdown](https://marketplace.visualstudio.com/items?itemName=mymarkdown.mymarkdown) VS Code
extension. After an agent saves a document of 400 or more words with at least two headings and no
labels yet, a hook tells it to run the `markdown-labels` skill, which writes label lenses to
`.mymd/` for the preview to draw. Nothing leaves your machine. Requires Node.js 18 or later.

Install once, and it runs in every project (each agent's own plugin command; see the extension
README's "Labels from your coding agent" section for the full list):

    claude plugin marketplace add ardeeshany/MyMarkdown && claude plugin install mymarkdown@mymarkdown-plugins
    copilot plugin marketplace add ardeeshany/MyMarkdown && copilot plugin install mymarkdown@mymarkdown-plugins
    codex plugin marketplace add ardeeshany/MyMarkdown && codex plugin add mymarkdown@mymarkdown-plugins
    devin plugins install ardeeshany/MyMarkdown#vscode-extension/agent-hooks/plugin

In a project that has the per-repo install (`npx mymarkdown-hooks init`), this plugin stays quiet.
