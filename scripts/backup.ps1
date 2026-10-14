#Requires -Version 3.0
<#
.SYNOPSIS
  Read-only-safe nightly backup: pg_dump custom format of the live database.
  Writes D:\backups\pgrow-YYYYMMDD-HHmm.dump + .sha256. Never modifies the DB.
  Retention: keeps the newest 14 dumps, deletes older ones.
.NOTES
  Requires PGPASSWORD env or pgpass. Never prints secrets.
#>
$ErrorActionPreference = "Stop"
$Bin = "D:\pgsql\pgsql\bin"
$Db = "pgrow"
if ($env:PGROW_DB -ne $null -and $env:PGROW_DB -ne "") { $Db = $env:PGROW_DB }
$Dir = "D:\backups"
New-Item -ItemType Directory -Force $Dir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmm"
$Dump = Join-Path $Dir "pgrow-$Stamp.dump"
& "$Bin\pg_dump.exe" -h localhost -U pgrow -Fc $Db -f $Dump
& "$Bin\pg_restore.exe" --list $Dump | Out-Null
if ($LASTEXITCODE -ne 0) { throw "dump integrity check failed" }
$Hash = (Get-FileHash $Dump -Algorithm SHA256).Hash
Set-Content "$Dump.sha256" "$Hash  pgrow-$Stamp.dump"
Get-ChildItem $Dir -Filter "pgrow-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | ForEach-Object {
  Remove-Item ($_.FullName + ".sha256") -ErrorAction SilentlyContinue
  Remove-Item $_.FullName
}
Write-Output "backup-ok $Dump sha256=$Hash"
