# claude-desktop-mods

Two Claude Code mods that make the Claude desktop app show where you are working.

## folder-band

A one-line status band above the prompt, in the app's own theme colors:

- the current folder as a full path, with the folder name highlighted
- git branch, with a green ✓ when clean or an amber ● when there are uncommitted changes
- context window, 5-hour and weekly rate limits as thin meters (amber from 75%, red from 90%); hover a meter for details
- model, effort and session duration

## projects-pane

A **Projects** dashboard pane that opens beside the chat at session start (reopen it with `/projects`):

- a card for the current folder: name, path, branch, last commit
- every git repository under `~/Projects`, grouped by its first folder; hidden folders are skipped
- per repository: **New session**, **New worktree** and **Insert path**

**New session** and **New worktree** ask Claude, in the current session, to start a new session in that repository. A mod cannot start a session by itself. **New worktree** names the branch `<type>/<ticket>-<slug>`, e.g. `feat/abc-123-outbound-retry`, or `<type>/<YYYYMMDD>-<slug>` without a ticket, and cuts it from `develop` when the repository has one.

## Install

At the prompt of a terminal session:

```
/plugin install folder-band --marketplace Jiranon-K/claude-desktop-mods
/plugin install projects-pane --marketplace Jiranon-K/claude-desktop-mods
```

From a shell:

```bash
claude plugin install folder-band --marketplace Jiranon-K/claude-desktop-mods
```

```bash
claude plugin install projects-pane --marketplace Jiranon-K/claude-desktop-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Jiranon-K/claude-desktop-mods`, then **Add plugin**.

## Develop

Each mod has a test: `claude plugin test <mod folder>`. Check a mod with `claude plugin validate <mod folder>`.

## License

MIT
