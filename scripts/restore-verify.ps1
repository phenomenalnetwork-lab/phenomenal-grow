#Requires -Version 3.0
<#
.SYNOPSIS
  Restore verification into SCRATCH database pgrow_verify. NEVER touches pgrow.
  Steps: drop+recreate pgrow_verify, restore latest dump, reconcile row counts
  per table against live, report PASS/FAIL. Refuses to run against pgrow.
#>
$ErrorActionPreference = "Stop"
$Bin = "D:\pgsql\pgsql\bin"
$Scratch = "pgrow_verify"
if ($Scratch -eq "pgrow") { throw "refusing: scratch must not be the live database" }
$Dir = "D:\backups"
$Latest = Get-ChildItem $Dir -Filter "pgrow-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Latest) { throw "no backup found in $Dir" }
$Expect = (Get-Content ($Latest.FullName + ".sha256") -ErrorAction SilentlyContinue | ForEach-Object { ($_ -split "\s+")[0] })
$Actual = (Get-FileHash $Latest.FullName -Algorithm SHA256).Hash
if ($Expect -and $Expect -ne $Actual) { throw "checksum mismatch on $($Latest.Name)" }
& "$Bin\psql.exe" -h localhost -U pgrow -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$Scratch';" | Out-Null
& "$Bin\psql.exe" -h localhost -U pgrow -d postgres -c "DROP DATABASE IF EXISTS $Scratch;" | Out-Null
& "$Bin\psql.exe" -h localhost -U pgrow -d postgres -c "CREATE DATABASE $Scratch OWNER pgrow;" | Out-Null
& "$Bin\pg_restore.exe" -h localhost -U pgrow -d $Scratch $Latest.FullName 2>&1 | Select-Object -First 3
$Tables = @("Organisation", "User", "Contact", "Message", "Conversation", "Activity", "Membership", "Appointment", "Followup", "Enrollment")
$sql = ""
foreach ($T in $Tables) { $sql += "SELECT count(*) FROM ""$T"";" + [Environment]::NewLine }
$sql | Set-Content "$Dir\verify-counts.sql"
$Fail = 0
$liveLines = & "$Bin\psql.exe" -h localhost -U pgrow -d pgrow -t -A -f "$Dir\verify-counts.sql"
$restLines = & "$Bin\psql.exe" -h localhost -U pgrow -d $Scratch -t -A -f "$Dir\verify-counts.sql"
for ($i = 0; $i -lt $Tables.Count; $i++) {
  $ls = ""
  if ($i -lt $liveLines.Count) { $ls = $liveLines[$i].Trim() }
  $rs = ""
  if ($i -lt $restLines.Count) { $rs = $restLines[$i].Trim() }
  $ok = ($ls -ne "" -and $ls -eq $rs)
  if (-not $ok) { $Fail++ }
  $mark = "MISMATCH"
  if ($ok) { $mark = "OK" }
  Write-Output ("{0}: live={1} restored={2} {3}" -f $Tables[$i], $ls, $rs, $mark)
}
if ($Fail -gt 0) { throw "restore verification FAILED ($Fail mismatches)" }
Write-Output ("restore-verify PASS from {0}" -f $Latest.Name)
