# OpenCode GitHub tools

OpenCode V2 GitHub workflow plugin. `/pr`, `/pr-comments`,
`/pr-comments-fix`, and `/pr-actions` are registered on the server so they
work from the web UI as well as the TUI. `/pr-review` remains TUI-only.

It registers `/pr`, `/pr-comments`, `/pr-comments-fix`, `/pr-actions`, and
`/pr-review`. The plugin requires an authenticated `gh` CLI; `/pr-review` also
requires Plannotator.

The OpenCode server must have an authenticated `gh` CLI for the GitHub commands.
