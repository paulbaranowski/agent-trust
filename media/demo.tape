# agent-trust CLI demo tape (charmbracelet/vhs).
#
# Regenerate the GIF and the still screenshot with:
#   vhs media/demo.tape
# Run it from the repository root. The tape drives the REAL `claude` binary
# against a throwaway $HOME seeded only with `hasCompletedOnboarding` (no auth,
# no account data), so it shows the actual first-run trust dialog appear and
# disappear without ever touching your real trust stores or leaking anything.
#
# Requires: `claude` on PATH, and `node`.

Output media/demo.gif

Require bash
Require claude
Require node

Set Shell bash
Set FontSize 20
Set Width 1160
Set Height 720
Set Padding 28
Set TypingSpeed 45ms

# Tokyo-night flavoured dark theme so the green checks and yellow prompt pop.
Set Theme { "name": "agent-trust", "background": "#1a1b26", "foreground": "#c0caf5", "cursor": "#c0caf5", "selection": "#283457", "black": "#15161e", "red": "#f7768e", "green": "#9ece6a", "yellow": "#e0af68", "blue": "#7aa2f7", "magenta": "#bb9af7", "cyan": "#7dcfff", "white": "#a9b1d6", "brightBlack": "#414868", "brightRed": "#f7768e", "brightGreen": "#9ece6a", "brightYellow": "#e0af68", "brightBlue": "#7aa2f7", "brightMagenta": "#bb9af7", "brightCyan": "#7dcfff", "brightWhite": "#c0caf5" }

# --- Hidden setup: isolated HOME, seeded config, CLI wired, quiet prompt. ---
Hide
Type `REPO="$PWD"`                                                                                     Enter
# Unique dir under the canonical /private/tmp (not the /var/folders TMPDIR
# symlink) so realpath-based path shortening still renders ~/project-alpha.
# Abort if mktemp fails: an empty $HOME makes os.homedir() fall back to the real
# home, and agent-trust would then touch live trust stores. The trap removes
# only the created dir when the recording shell exits.
Type `DEMOHOME="$(mktemp -d /private/tmp/agent-trust-demo.XXXXXX)" || exit 1`                          Enter
Type `export HOME="$DEMOHOME"`                                                                         Enter
Type `trap 'rm -rf "$DEMOHOME"' EXIT`                                                                  Enter
Type `mkdir -p "$HOME/project-alpha"`                                                                  Enter
Type `printf '%s' '{"hasCompletedOnboarding":true,"numStartups":9,"installMethod":"native","autoUpdates":false}' > "$HOME/.claude.json"` Enter
Type `export DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 FORCE_COLOR=3`           Enter
Type `agent-trust() { node "$REPO/bin/agent-trust.js" "$@"; }`                                         Enter
Type `cd "$HOME/project-alpha"`                                                                        Enter
Type `export PS1="\[\e[38;5;111m\]\w\[\e[0m\] \[\e[38;5;150m\]\$\[\e[0m\] "`                            Enter
Type `clear`                                                                                           Enter
Show

# === Scene 1: baseline — a fresh directory makes claude stop and ask ===
Sleep 700ms
Type "# Fresh directory: claude asks before it can touch anything"
Sleep 250ms  Enter  Sleep 450ms
Type "claude"
Sleep 150ms  Enter
Sleep 2s
Screenshot media/screenshot.png
Sleep 700ms
Escape
Sleep 500ms
Hide
Type "clear"  Enter
Show

# === Scene 2: seed trust once, and claude walks straight in ===
Sleep 500ms
Type "agent-trust add --agent claude --dir ~/project-alpha"
Sleep 200ms  Enter
Sleep 900ms
Type "agent-trust list"
Sleep 200ms  Enter
Sleep 1.6s
Type "# Trust recorded: claude walks straight in, no dialog"
Sleep 250ms  Enter  Sleep 450ms
Type "claude"
Sleep 150ms  Enter
Sleep 2s
Ctrl+C
Sleep 250ms
Ctrl+C
Sleep 500ms
Hide
Type "clear"  Enter
Show

# === Scene 3: revoke trust, and the dialog comes back ===
Sleep 500ms
Type "agent-trust remove --path ~/project-alpha"
Sleep 200ms  Enter
Sleep 900ms
Type "agent-trust list"
Sleep 200ms  Enter
Sleep 1.7s
Type "# Trust revoked: claude asks again"
Sleep 250ms  Enter  Sleep 450ms
Type "claude"
Sleep 150ms  Enter
Sleep 2s
Escape
Sleep 1.2s
