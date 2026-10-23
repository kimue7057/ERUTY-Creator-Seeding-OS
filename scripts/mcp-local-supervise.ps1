param([switch]$CheckOnly, [string]$NodeExecutable = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'The local runtime supervisor requires Windows.' }
$workspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspace
if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node -ErrorAction Stop).Source }
if (-not [IO.Path]::IsPathFullyQualified($NodeExecutable) -or -not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) { throw 'An installed Node executable is required.' }
$env:PATH = (Split-Path -Parent $NodeExecutable) + ';' + $env:PATH
$stateFile = Join-Path $workspace '.local/mcp-local-e2e/supervisor-status.json'
$attempts = @{ probe = 0; discovery = 0 }
$mutex = [Threading.Mutex]::new($false, 'Local\ERUTY-MCP-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
$ownsMutex = $false

function Read-LocalJson([Uri]$Base, [string]$Path) {
  $response = Invoke-WebRequest -Uri ([Uri]::new($Base, $Path)) -TimeoutSec 3 -MaximumRedirection 0
  $response.Content | ConvertFrom-Json -AsHashtable
}
function Read-Runtime([string]$Mode, [string]$Issuer, [string]$Target) {
  $alias = "eruty-$Mode-local"
  $file = Join-Path $env:USERPROFILE ".local/state/tunnel-client/health/$alias.url"
  $base = [Uri](Get-Content -LiteralPath $file -Raw).Trim()
  if ($base.Scheme -cne 'http' -or $base.Host -cne '127.0.0.1' -or $base.UserInfo -or $base.AbsolutePath -cne '/' -or $base.Query -or $base.Fragment) { throw 'Unexpected health URL' }
  $health = Read-LocalJson $base '/health?details=true'
  $oauth = Read-LocalJson $base '/api/oauth'
  $status = Read-LocalJson $base '/api/status'
  $capture = Read-LocalJson $base '/api/harpoon/status'
  if (-not $health.live -or -not $health.ready -or $oauth['error'] -or $oauth.selected_authorization_server -cne $Issuer -or $status.mcp_server_url -cne $Target -or $status.raw_http_logging_enabled -ne $false -or $capture.capture_payloads -ne $false) { throw 'Runtime needs recovery' }
  return @{ state = 'ready'; instance_id = $health.runtime.instance_id; hosted_work_verified = $false }
}
try {
  if (-not $CheckOnly) {
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { throw 'Another supervisor already owns these local runtimes.' }
  }
  do {
    $report = @{ checked_at = [DateTimeOffset]::UtcNow.ToString('o'); modes = @{}; automatic_grant_renewal = $false; automatic_origin_change = $false }
    foreach ($mode in @('probe', 'discovery')) {
      $configFile = if ($mode -eq 'discovery') { '.local/discovery/operator.env' } else { '.local/mcp-staging/.env' }
      $lines = @(Get-Content -LiteralPath $configFile | Where-Object { $_ -cmatch '^MCP_OAUTH_ISSUER=' })
      if ($lines.Count -ne 1) { throw 'Exactly one configured issuer is required.' }
      $issuer = $lines[0].Substring('MCP_OAUTH_ISSUER='.Length)
      $issuerUrl = [Uri]$issuer
      if ($issuerUrl.Scheme -cne 'https' -or $issuerUrl.UserInfo -or $issuerUrl.Query -or $issuerUrl.Fragment) { throw 'Invalid configured issuer' }
      $port = if ($mode -eq 'discovery') { 3311 } else { 3310 }
      $target = "http://127.0.0.1:$port/mcp"
      try { $report.modes[$mode] = Read-Runtime $mode $issuer $target; $attempts[$mode] = 0 }
      catch {
        $report.modes[$mode] = @{ state = 'not_ready'; connection_attempts = $attempts[$mode] }
        if ($CheckOnly) { continue }
        try {
          # Recover transport only after the existing issuer and gateway agree.
          # Never create a new hostname, user session, grant or discovery run.
          $metadata = Read-LocalJson ([Uri]$target) '/.well-known/oauth-protected-resource/mcp'
          $authorizationServer = Read-LocalJson $issuerUrl ($issuerUrl.AbsolutePath.TrimEnd('/') + '/.well-known/openid-configuration')
          if ($metadata.authorization_servers[0] -cne $issuer -or $authorizationServer.issuer -cne $issuer) { throw 'Issuer metadata mismatch' }
          if ($attempts[$mode] -ge 3) { $report.modes[$mode].state = 'operator_required'; continue }
          $attempts[$mode]++
          & (Join-Path $PSScriptRoot 'mcp-local-access.ps1') -Mode $mode -Action Connect
          if ($LASTEXITCODE -ne 0) { throw 'Managed connect failed' }
          $report.modes[$mode] = Read-Runtime $mode $issuer $target
        } catch { $report.modes[$mode] = @{ state = 'waiting_for_operator_or_dependencies'; connection_attempts = $attempts[$mode]; error_type = $_.Exception.GetType().Name } }
      }
    }
    [IO.File]::WriteAllText($stateFile, ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    if ($CheckOnly) {
      $report | ConvertTo-Json -Depth 5 | Write-Output
      if (@($report.modes.Values | Where-Object { $_.state -cne 'ready' }).Count) { exit 1 }
    } else { Start-Sleep -Seconds 30 }
  } while (-not $CheckOnly)
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
