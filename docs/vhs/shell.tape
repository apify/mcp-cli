# mcpc shell — interactive REPL
#
#   cd docs/vhs && vhs shell.tape

Output shell.gif

Require mcpc

Set Shell           "bash"
Set FontFamily      "JetBrains Mono"
Set FontSize        16
Set Width           1100
Set Height          650
Set Padding         20
Set TypingSpeed     60ms
Set Theme           "Catppuccin Mocha"
Set WindowBar       Colorful
Set WindowBarSize   32
Set BorderRadius    8

Hide
Type "export PS1='$ '"
Enter
Type "mcpc connect mcp.apify.com @apify --header \"Authorization: Bearer ${APIFY_TOKEN}\" >/dev/null 2>&1 || true"
Enter
Type "clear"
Enter
Show

Type "# Drop into an interactive shell against the session"
Sleep 600ms
Enter
Type "mcpc @apify shell"
Sleep 400ms
Enter
Sleep 2500ms

Type "help"
Sleep 400ms
Enter
Sleep 3s

Type "tools-list"
Sleep 400ms
Enter
Sleep 4s

Type "grep scraper"
Sleep 400ms
Enter
Sleep 3s

Type 'tools-call search-actors keywords:="crawler" limit:=2'
Sleep 400ms
Enter
Sleep 5s

Type "exit"
Sleep 400ms
Enter
Sleep 1500ms
