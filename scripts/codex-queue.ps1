#Requires -Version 5.1
<#
.SYNOPSIS
  Queue one text message with the native Codex CLI; no auth/config/app changes.
.DESCRIPTION
  Requires an explicit -Thread or opt-in -Latest. CODEX_HOME is honored.
  Latest means filesystem activity, not the foreground chat. Inspect -DryRun
  first, then prefer -Thread. DryRun probes queue help but never sends a message.
  Windows requires a native codex.exe, not a .cmd/.ps1 shim.
.EXAMPLE
  .\codex-queue.ps1 -Thread <id-or-exact-name> -Message 'continue'
.EXAMPLE
  .\codex-queue.ps1 -Latest -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Position=0)][string]$Message = '',
  [string]$Thread = '',
  [switch]$Latest,
  [switch]$DryRun,
  [string]$CodexExe = $env:CODEX_EXE
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function ConvertTo-NativeArgument([string]$Value) {
  # Windows CRT quoting for .NET Framework / Windows PowerShell 5.1:
  # double backslashes before a quote and before the closing quote.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Invoke-CodexNative([string]$Exe, [string[]]$Arguments, [switch]$Probe) {
  # Avoid cmd.exe and PowerShell's legacy native-argument serialization: quotes,
  # Unicode, newlines, trailing slashes and shell metacharacters must stay data.
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Exe
  $info.UseShellExecute = $false
  if ($null -ne $info.PSObject.Properties['ArgumentList']) {
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
  } else {
    $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
  }
  $info.RedirectStandardOutput = [bool]$Probe
  $info.RedirectStandardError = [bool]$Probe
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  try {
    [void]$process.Start()
    if ($Probe) {
      $stdout = $process.StandardOutput.ReadToEndAsync()
      $stderr = $process.StandardError.ReadToEndAsync()
      if (-not $process.WaitForExit(10000)) {
        $process.Kill()
        throw 'Codex queue help timed out; select the matching app-bundled CLI with -CodexExe.'
      }
      $process.WaitForExit()
      return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $stdout.Result }
    }
    $process.WaitForExit()
    return $process.ExitCode
  } finally {
    $process.Dispose()
  }
}

function Test-CodexQueue([string]$Path) {
  # A successful generic help response is not enough: check queue-specific flags.
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  if ($env:OS -eq 'Windows_NT' -and [IO.Path]::GetExtension($Path) -ine '.exe') { return $false }
  try {
    $nativePath = (Get-Item -LiteralPath $Path).FullName
    $probe = Invoke-CodexNative $nativePath @('queue', '--help') -Probe
    return $probe.ExitCode -eq 0 -and $probe.Output.Contains('--thread') -and $probe.Output.Contains('--message')
  } catch { return $false }
}

function Resolve-CodexExe([string]$Explicit, [string]$CodexHomeDir) {
  # Pinning is authoritative: do not fall back after an invalid explicit choice.
  if (-not [string]::IsNullOrEmpty($Explicit)) {
    if (-not (Test-CodexQueue $Explicit)) {
      throw 'Selected CLI does not support queue --thread/--message. On Windows, -CodexExe must name a native .exe, not a command shim.'
    }
    return (Get-Item -LiteralPath $Explicit).FullName
  }
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  if ($env:LOCALAPPDATA) {
    $binRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    $bundled = @(Get-ChildItem -LiteralPath $binRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName 'codex.exe') -ErrorAction SilentlyContinue } |
      Sort-Object LastWriteTimeUtc, FullName -Descending)
    foreach ($file in $bundled) { $candidates.Add($file.FullName) }
  }
  foreach ($root in @($CodexHomeDir, (Join-Path $HOME '.codex'))) {
    $candidates.Add((Join-Path $root 'packages\standalone\current\bin\codex.exe'))
    $candidates.Add((Join-Path $root 'packages\standalone\current\codex.exe'))
  }
  foreach ($name in @('codex.exe', 'codex')) {
    foreach ($command in @(Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue)) {
      $candidates.Add($command.Source)
    }
  }
  foreach ($candidate in $candidates) {
    if (Test-CodexQueue $candidate) { return (Get-Item -LiteralPath $candidate).FullName }
  }
  throw 'No queue-capable native Codex CLI found. Install/update Codex or supply -CodexExe.'
}

function Resolve-LatestThread([string]$CodexHomeDir) {
  # Scan only the effective store. Fail on incomplete reads instead of silently
  # selecting from another account/home. Deterministic filename order breaks ties.
  $sessions = Join-Path $CodexHomeDir 'sessions'
  if (-not (Test-Path -LiteralPath $sessions -PathType Container)) {
    throw 'No sessions directory under the effective CODEX_HOME.'
  }
  $uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  $pattern = '^rollout-.+-(' + $uuid + ')(_' + $uuid + ')?\.jsonl$'
  $latestFile = Get-ChildItem -LiteralPath $sessions -Recurse -File -Filter 'rollout-*.jsonl' |
    Where-Object { $_.Name -match $pattern } |
    Sort-Object LastWriteTimeUtc, FullName -Descending |
    Select-Object -First 1
  if ($null -eq $latestFile -or $latestFile.Name -notmatch $pattern) {
    throw 'No recognized rollout thread found; specify -Thread explicitly.'
  }
  return $Matches[1]
}

try {
  if ([string]::IsNullOrEmpty($Thread) -and -not $Latest) {
    throw 'Choose -Thread <id-or-exact-name> or explicitly opt in with -Latest.'
  }
  if (-not [string]::IsNullOrEmpty($Thread) -and $Latest) { throw '-Thread and -Latest are mutually exclusive.' }
  if (-not $DryRun -and [string]::IsNullOrEmpty($Message)) { throw 'A nonempty message is required.' }
  if ($Message.IndexOf([char]0) -ge 0 -or $Thread.IndexOf([char]0) -ge 0) { throw 'NUL characters cannot be passed to the native CLI.' }
  $codexHomeDir = if ([string]::IsNullOrEmpty($env:CODEX_HOME)) { Join-Path $HOME '.codex' } else { $env:CODEX_HOME }
  if ($Latest) {
    $Thread = Resolve-LatestThread $codexHomeDir
    Write-Warning '-Latest may select a different project or a subagent, not the foreground chat.'
  }
  $exe = Resolve-CodexExe $CodexExe $codexHomeDir
  if ($DryRun) {
    Write-Output "Codex: $exe" "Thread: $Thread" 'Dry run only; no message was queued.'
    exit 0
  }
  # Preserve the CLI's exit code. Never retry an ambiguous queue result automatically.
  $code = Invoke-CodexNative $exe @('queue', "--thread=$Thread", "--message=$Message")
  exit $code
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
