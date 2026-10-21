param([Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef)
$ErrorActionPreference = 'Stop'
$taskTempPath = Join-Path ([IO.Path]::GetTempPath()) ('synq-email-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskTempPath | Out-Null
function New-ServerKey {
  $bytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}
try {
  $secretMetadata = npx --yes supabase secrets list --project-ref $ProjectRef | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Could not check server secrets.' }
  $settings = @()
  if ($secretMetadata.secrets.name -notcontains 'GMAIL_TOKEN_ENCRYPTION_KEY') {
    $settings += 'GMAIL_TOKEN_ENCRYPTION_KEY=' + (New-ServerKey)
  }
  $needsWorkerKey = $secretMetadata.secrets.name -notcontains 'OUTREACH_WORKER_SECRET'
  if ($needsWorkerKey) {
    $workerKey = New-ServerKey
    $settings += 'OUTREACH_WORKER_SECRET=' + $workerKey
  }
  if ($settings.Count -gt 0) {
    $envPath = Join-Path $taskTempPath 'server.env'
    [IO.File]::WriteAllLines($envPath,$settings)
    npx --yes supabase secrets set --env-file $envPath --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw 'Could not save email server secrets.' }
  }
  if ($needsWorkerKey) {
    $sqlPath = Join-Path $taskTempPath 'worker-vault.sql'
    # ProjectRef and workerKey have restricted alphabets. The secret is never
    # printed, passed in process arguments, or written into repository files.
    $sql = @"
do `$`$
declare existing uuid;
begin
  select id into existing from vault.secrets where name='outreach_worker_secret' limit 1;
  if existing is null then perform vault.create_secret('$workerKey','outreach_worker_secret');
  else perform vault.update_secret(existing,'$workerKey'); end if;
  select id into existing from vault.secrets where name='outreach_worker_url' limit 1;
  if existing is null then perform vault.create_secret('https://$ProjectRef.supabase.co/functions/v1/email-worker','outreach_worker_url');
  else perform vault.update_secret(existing,'https://$ProjectRef.supabase.co/functions/v1/email-worker'); end if;
end; `$`$;
"@
    [IO.File]::WriteAllText($sqlPath,$sql)
    npx --yes supabase db query --linked --project-ref $ProjectRef --file $sqlPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not save the worker secret in Vault. Reconcile Vault before enabling the cron job.' }
  }
  Write-Output 'Email encryption and worker secrets configured. OAuth client credentials are configured separately.'
} finally {
  # Only delete the exact temporary files created above; never recurse over a
  # computed folder or remove unrelated temporary data.
  foreach ($filename in @('server.env','worker-vault.sql')) {
    $filePath = Join-Path $taskTempPath $filename
    if (Test-Path -LiteralPath $filePath) { Remove-Item -LiteralPath $filePath }
  }
  Remove-Item -LiteralPath $taskTempPath
}
