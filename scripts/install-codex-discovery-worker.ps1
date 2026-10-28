param([string]$Config = '.local/discovery/codex-browser/worker.config.private.json', [string]$NodePath = '', [switch]$Run)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$gitMetadata = (& git -C $repoRoot rev-parse --path-format=absolute --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetPathRoot($gitMetadata) -ne [IO.Path]::GetPathRoot($repoRoot)) { throw 'Use an independent local clone on the same NTFS drive. Linked Git metadata on a cloud drive can prevent Windows sandbox initialization.' }
$configPath = (Resolve-Path -LiteralPath (Join-Path $repoRoot $Config)).Path
$privateRoot = (Join-Path $repoRoot '.local\discovery\codex-browser') + [IO.Path]::DirectorySeparatorChar
if (-not $configPath.StartsWith($privateRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Worker config must be inside the private discovery directory.' }
$taskNode = if ($NodePath) { (Resolve-Path -LiteralPath $NodePath).Path } else { (Get-Command node -ErrorAction Stop).Source }
$workerScript = Join-Path $PSScriptRoot 'codex-discovery-worker.ts'
function Quote-Argument([string]$Value) { if ($Value.Contains('"')) { throw 'Invalid path' }; return '"' + $Value + '"' }
if ($Run) {
  $arguments = '--import tsx ' + (Quote-Argument $workerScript) + ' ' + (Quote-Argument $configPath)
  $process = Start-Process -FilePath $taskNode -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $privateRoot 'worker.private.log') -RedirectStandardError (Join-Path $privateRoot 'worker-error.private.log')
  exit $process.ExitCode
}
$taskName = 'ERUTY Codex Discovery Worker'
$shellPath = (Get-Process -Id $PID).Path
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + (Quote-Argument $PSCommandPath) + ' -Config ' + (Quote-Argument $Config) + ' -NodePath ' + (Quote-Argument $taskNode) + ' -Run'
$action = New-ScheduledTaskAction -Execute $shellPath -Argument $arguments -WorkingDirectory $repoRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not ($existing.Actions | Where-Object { $_.Execute -eq $shellPath -and $_.Arguments.Contains((Quote-Argument $PSCommandPath)) -and $_.Arguments.Contains((Quote-Argument $Config)) })) { throw 'A different worker task already exists; preserve it and resolve the configuration first.' }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Installed and started the current-user ERUTY worker. Keep Codex and the SNS browser connected.'
