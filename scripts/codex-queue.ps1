<#
.SYNOPSIS
  Send a message to an existing Codex thread via the native codex queue
  command, bypassing the desktop composer's client-side usage gate.

.DESCRIPTION
  Uses only the app's own app-server daemon and thread store. No proxy, no
  certificate, no app modification. When -Thread is omitted, the newest
  rollout under ~/.codex/sessions is used.

.EXAMPLE
  .\codex-queue.ps1 "continue with the next step"
  .\codex-queue.ps1 -Thread 019f644b-a10a-73c2-8c3f-f3c7713a2928 "status?"
#>
param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$Message,
  [string]$Thread
)

function Resolve-CodexExe {
  $binRoot = Join-Path $env:LOCALAPPDATA "OpenAI\\Codex\\bin"
  $candidates = @(Get-ChildItem $binRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName "codex.exe" } |
    Where-Object { Test-Path $_ })
  if ($candidates) { return $candidates[0] }
  $cmd = Get-Command codex -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "codex.exe not found on PATH or under $binRoot"
}

function Resolve-LatestThread {
  $sessions = Join-Path $env:USERPROFILE ".codex\\sessions"
  $latest = Get-ChildItem $sessions -Recurse -Filter "rollout-*.jsonl" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) { throw "no rollout sessions found under $sessions" }
  if ($latest.Name -match "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})") {
    return $Matches[1]
  }
  throw "could not parse thread id from $($latest.Name)"
}

if (-not $Thread) { $Thread = Resolve-LatestThread }
$exe = Resolve-CodexExe
& $exe queue --thread $Thread --message $Message
exit $LASTEXITCODE
