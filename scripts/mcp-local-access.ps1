param(
  [ValidateSet('Collect', 'Inspect', 'Doctor', 'Connect', 'Status', 'Stop', 'OAuthLogin', 'SelfTest')]
  [string]$Action = 'Collect',
  [ValidateSet('probe', 'discovery')]
  [string]$Mode = 'probe'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This helper requires Windows user-scoped DPAPI.' }
$workspace = Split-Path -Parent $PSScriptRoot
$sharedDirectory = Join-Path $workspace '.local/mcp-local-e2e'
$privateDirectory = if ($Mode -eq 'discovery') { Join-Path $workspace '.local/discovery' } else { $sharedDirectory }
$tunnelBinary = Join-Path $workspace '.local/bin/tunnel-client/tunnel-client.exe'
$metadataFile = Join-Path $privateDirectory 'connection.json'
$secretFile = Join-Path $sharedDirectory 'runtime-key.dpapi'
$profileDirectory = Join-Path $privateDirectory 'profiles'
$profileName = if ($Mode -eq 'discovery') { 'eruty-discovery-local' } else { 'eruty-probe-local' }
$targetUrl = if ($Mode -eq 'discovery') { 'http://127.0.0.1:3311/mcp' } else { 'http://127.0.0.1:3310/mcp' }
if ($Mode -eq 'discovery' -and $Action -eq 'Collect') { throw 'Discovery reuses the existing encrypted runtime key. Save its separate tunnel ID through discovery-local prepare; never overwrite Probe credentials.' }

function Test-TunnelId([string]$Value) { return $Value -cmatch '^tunnel_[A-Za-z0-9_-]{8,128}$' }
function Get-Plaintext([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Save-PrivateText([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Initialize-PrivateDirectory {
  [IO.Directory]::CreateDirectory($privateDirectory) | Out-Null
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $existing = Get-Acl -LiteralPath $privateDirectory
  if ($existing.AreAccessRulesProtected -and $existing.Access.Count -eq 1) {
    $rule = $existing.Access[0]
    $ruleIdentity = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier])
    if ($ruleIdentity -eq $identity -and $rule.AccessControlType -eq 'Allow' -and (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) { return }
  }
  if ($Action -ne 'Collect') { throw 'Private credential directory must allow only the current user. Re-run Collect locally.' }
  $permissions = [Security.AccessControl.DirectorySecurity]::new()
  $permissions.SetOwner($identity)
  $permissions.SetAccessRuleProtection($true, $false)
  $permissions.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $privateDirectory -AclObject $permissions
}
function Invoke-PrivateTunnel([string[]]$Arguments, [string]$Filename) {
  $output = & $tunnelBinary @Arguments 2>&1
  $resultCode = $LASTEXITCODE
  Save-PrivateText (Join-Path $privateDirectory $Filename) (($output | ForEach-Object { $_.ToString() }) -join "`n")
  # Vendor HTTP raw logging stays disabled. Never replay provider responses or credentials to the console.
  @{ checkpoint = $Action.ToLowerInvariant(); exit_code = $resultCode; private_report = $Filename } | ConvertTo-Json -Compress | Write-Output
  if ($resultCode -ne 0) { throw 'Tunnel command failed; inspect the private redacted report locally.' }
}

if ($Action -eq 'SelfTest') {
  $synthetic = [Guid]::NewGuid().ToString('N')
  $secure = ConvertTo-SecureString $synthetic -AsPlainText -Force
  try {
    $ciphertext = ConvertFrom-SecureString $secure
    $restored = ConvertTo-SecureString $ciphertext
    try { if ((Get-Plaintext $restored) -cne $synthetic -or $ciphertext.Contains($synthetic)) { throw 'DPAPI round-trip failed' } }
    finally { $restored.Dispose() }
    if (-not (Test-TunnelId 'tunnel_0123456789abcdef0123456789abcdef') -or (Test-TunnelId "tunnel_bad`nvalue")) { throw 'Tunnel ID validation failed' }
    Write-Output 'Windows DPAPI round-trip and tunnel ID validation passed; no credentials saved.'
  } finally { $secure.Dispose(); $synthetic = $null }
  exit 0
}

Initialize-PrivateDirectory
if ($Action -eq 'OAuthLogin') {
  $userFile = (Join-Path $sharedDirectory 'oauth-user.json').Replace("'", "''")
  if (-not (Test-Path -LiteralPath $userFile)) { throw 'Prepare the synthetic local IdP first.' }
  # Only the separate interactive console displays the synthetic password. No secret in argv/stdout.
  $displayCode = @"
`$host.UI.RawUI.WindowTitle = 'ERUTY - Synthetic OAuth Login'
`$account = Get-Content -LiteralPath '$userFile' -Raw | ConvertFrom-Json
Write-Host 'Use this account only on the ERUTY synthetic Keycloak login reached from ChatGPT Plugins.'
Write-Host 'Username:' `$account.username
Write-Host 'Password:' `$account.password
Write-Host 'Never paste this password into chat, Git, PRs or logs.'
Read-Host 'After completing login and consent, press Enter to close' | Out-Null
Clear-Host
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($displayCode))
  Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -WindowStyle Normal | Out-Null
  Write-Output 'Opened the interactive synthetic OAuth credential window; no credentials printed here.'
  exit 0
}
if ($Action -eq 'Collect') {
  $host.UI.RawUI.WindowTitle = 'ERUTY - Private Tunnel Credentials'
  Write-Host 'Enter values here only. Do not paste an API key into chat, Git or a command argument.'
  Write-Host 'Use a dedicated runtime API key whose principal has Tunnels Read + Use; do not use an admin key.'
  Write-Host 'Key management: https://platform.openai.com/settings/organization/api-keys'
  $tunnelId = Read-Host 'Tunnel ID from Platform'
  if (-not (Test-TunnelId $tunnelId)) { throw 'Invalid Tunnel ID' }
  $runtimeSecret = Read-Host 'Dedicated runtime API key (input is masked)' -AsSecureString
  try {
    $plaintext = Get-Plaintext $runtimeSecret
    if ($plaintext -cnotmatch '^sk-[A-Za-z0-9_-]{16,512}$') { throw 'Invalid runtime key format' }
    Save-PrivateText $secretFile (ConvertFrom-SecureString $runtimeSecret)
    Save-PrivateText $metadataFile (@{ tunnel_id = $tunnelId; target = 'http://127.0.0.1:3310/mcp'; profile = $profileName } | ConvertTo-Json)
    $plaintext = $null
    Write-Host 'Saved for this Windows user only. No network connection or Work call was made.'
  } finally { $runtimeSecret.Dispose(); $plaintext = $null }
  Read-Host 'Press Enter to close' | Out-Null
  exit 0
}

if (-not (Test-Path -LiteralPath $tunnelBinary)) { throw 'Install the verified official tunnel-client first.' }
$connection = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
if (-not (Test-TunnelId $connection.tunnel_id) -or $connection.target -cne $targetUrl) { throw 'Invalid local connection configuration' }
$savedEnvironment = $env:CONTROL_PLANE_API_KEY
$runtimeSecret = ConvertTo-SecureString (Get-Content -LiteralPath $secretFile -Raw)
try {
  $env:CONTROL_PLANE_API_KEY = Get-Plaintext $runtimeSecret
  switch ($Action) {
    'Inspect' { Invoke-PrivateTunnel @('admin', '--json', 'tunnels', 'get', $connection.tunnel_id) 'tunnel-inspection.json' }
    'Doctor' {
      if (-not (Test-Path -LiteralPath (Join-Path $profileDirectory "$profileName.yaml"))) {
        Invoke-PrivateTunnel @('init', '--profile', $profileName, '--profile-dir', $profileDirectory, '--tunnel-id', $connection.tunnel_id, '--mcp-server-url', $connection.target, '--health-listen-addr', '127.0.0.1:3320') 'tunnel-init.log'
      }
      & node --import tsx (Join-Path $PSScriptRoot 'mcp-tunnel-profile.ts') $Mode
      if ($LASTEXITCODE -ne 0) { throw 'Persistent OAuth routing validation failed' }
      Invoke-PrivateTunnel @('doctor', '--profile', $profileName, '--profile-dir', $profileDirectory, '--explain', '--json') 'tunnel-doctor.json'
    }
    'Connect' {
      $routingJson = & node --import tsx (Join-Path $PSScriptRoot 'mcp-tunnel-profile.ts') $Mode '--runtime-environment'
      if ($LASTEXITCODE -ne 0) { throw 'Persistent OAuth routing validation failed' }
      $routing = $routingJson | ConvertFrom-Json -AsHashtable
      $routingKeys = @('MCP_OAUTH_TRUSTED_ORIGINS', 'HARPOON_TARGETS', 'HARPOON_ALLOW_PLAINTEXT_HTTP', 'HARPOON_CAPTURE_PAYLOADS', 'LOG_HTTP_RAW_UNSAFE')
      if ($routing.Count -ne $routingKeys.Count -or @($routing.Keys | Where-Object { $_ -cnotin $routingKeys }).Count -ne 0) { throw 'Unexpected managed runtime environment' }
      $previousRouting = @{}
      try {
        foreach ($key in $routingKeys) {
          $previousRouting[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
          [Environment]::SetEnvironmentVariable($key, $routing[$key], 'Process')
        }
        # connect rewrites YAML and reuses an existing PID. A fresh managed child
        # is required to inherit validated routing. Preserve alias, key and ID.
        Invoke-PrivateTunnel @('runtimes', '--json', 'stop', $profileName) 'tunnel-before-connect-stop.json'
        Invoke-PrivateTunnel @('runtimes', '--json', 'connect', '--alias', $profileName, '--profile', $profileName, '--profile-dir', $profileDirectory, '--tunnel-id', $connection.tunnel_id, '--mcp-server-url', $connection.target, '--runtime-api-key', 'env:CONTROL_PLANE_API_KEY') 'tunnel-connect.json'
        # Mirror the effective overrides back into YAML for offline Doctor.
        & node --import tsx (Join-Path $PSScriptRoot 'mcp-tunnel-profile.ts') $Mode
        if ($LASTEXITCODE -ne 0) { throw 'Managed profile verification failed' }
        & node --import tsx (Join-Path $PSScriptRoot 'mcp-tunnel-profile.ts') $Mode '--verify-runtime'
        if ($LASTEXITCODE -ne 0) { throw 'Managed runtime is not ready with the expected OAuth issuer and routing; inspect private diagnostics' }
      } finally {
        foreach ($key in $previousRouting.Keys) { [Environment]::SetEnvironmentVariable($key, $previousRouting[$key], 'Process') }
      }
    }
    'Status' { Invoke-PrivateTunnel @('runtimes', '--json', 'status', $profileName) 'tunnel-status.json' }
    'Stop' { Invoke-PrivateTunnel @('runtimes', '--json', 'stop', $profileName) 'tunnel-stop.json' }
  }
} finally {
  $env:CONTROL_PLANE_API_KEY = $savedEnvironment
  $runtimeSecret.Dispose()
}
