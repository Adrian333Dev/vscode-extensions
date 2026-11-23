# VS Code extensions

Small VS Code extensions, one folder each. Each works in any VS Code window, and builds and installs on its own.

- `html-preview/`: opens any HTML file rendered in a normal editor tab, redrawn on every change to it or a local script it loads. "Reopen With > Text Editor" shows the source.
- `notepad/`: on hold, not installed, being redesigned (notes in the opened folder, any note linked to a live session). As built: titled notes in groups, in its own sidebar section. Notes are markdown files in each project's `.notepad/` folder (`<group>/<title>.md`), listed under the project's name on its colour; `.notepad/` is committed with the project, so notes sync through its repo. A note whose header holds `session: <id>` is a Claude Code session's draft: Ctrl+Enter in its tab moves the text to `~/.local/state/notepad/outbox/<id>.md` and empties the note, and the session's mod sends it. `node --test notepad/tests/*.test.js` runs its tests.
- `project-colors/`: in a window opened on one folder holding several projects (each a git repo in a top-level subfolder), paints the window in the colour of the project you work in, through [Peacock](https://github.com/johnpapa/vscode-peacock). It follows the active tab's file, or the active terminal's folder; nothing open, no colour. A file or terminal of the workspace itself, in no project, shows the workspace's name and the window's own colours. The status bar shows the project's name on a lighter shade, lightened past Peacock's 10% where needed to stand clear of the bar, and the title bar `<project> · <workspace>`. Each project's colour stays in its own `.vscode/settings.json` (`peacock.remoteColor` under WSL, else `peacock.color`). Commands: "Project colors: Set up this workspace" turns it on and gives projects without a colour a free one from the favourites; "Change this project's colour" on a project folder's right-click menu runs Peacock's own colour commands and saves the result into the project. It also sets Peacock's favourites to a dark palette and the lighter shade to 10%. `node --test project-colors/tests/*.test.js` runs its tests.

## Install

```sh
./install.sh               # every extension
./install.sh html-preview  # one
```

`install.sh` packages each folder with `vsce` into `.build/` and installs it with `code --install-extension`.
