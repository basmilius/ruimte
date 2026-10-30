# Run by the installer and uninstaller (`installer.nsh`), so this copy is the installer's own and works on
# whatever an older release left behind. Only what runs from this installation is touched: a daemon from
# `ruimte service install` or a checkout holds none of its files.
#
#   check    exit 0 when something runs from the installation, otherwise 1
#   stop     exit 0 when nothing runs anymore, 2 when something still runs, 3 and 4 the same when this run disabled the task
#   remove   deletes the installation's task and the copy of its definition
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][ValidateSet('check', 'stop', 'remove')][string]$Action
)

# A step that fails leaves the hard stop at the end, and the exit code says what is left.
$ErrorActionPreference = 'SilentlyContinue'

$taskName = 'app.ruimte.daemon'
$root = $InstallDir.TrimEnd('\') + '\'
$daemonPath = $root + 'resources\bin\ruimte.exe'
$defaultPort = 4210
$daemonStopSeconds = 10
$appExitSeconds = 3

function Get-Installed {
    @(Get-CimInstance Win32_Process | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
}

# Through `@()`: Windows PowerShell gives a single CIM instance no `Count`, so one process would read as none.
function Test-Running {
    @(Get-Installed).Count -gt 0
}

function Get-OwnTask {
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
    if (-not $task) {
        return $null
    }
    # The script a task carries in `Documentation`, or a task's line from before it had one, has a caret
    # before everything cmd.exe reads as syntax, spaces among them, and a script doubles a percent.
    $line = "$($task.Documentation) $($task.Actions[0].Arguments)".Replace('^', '').Replace('%%', '%')
    if ($line.IndexOf($daemonPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return $null
    }
    return $task
}

function Request-Shutdown($daemon) {
    $port = $defaultPort
    if ($daemon.CommandLine -match '--port\D+(\d+)') {
        $port = [int]$Matches[1]
    }
    # The local secret goes only to a port this very process holds, which Windows vouches for here.
    $holder = Get-NetTCPConnection -State Listen -LocalPort $port | Where-Object { $_.OwningProcess -eq $daemon.ProcessId }
    if (-not $holder) {
        return
    }
    $home_ = if ($env:RUIMTE_HOME) { $env:RUIMTE_HOME } else { Join-Path $env:USERPROFILE '.ruimte' }
    $secret = (Get-Content -Raw (Join-Path $home_ 'local.key')).Trim()
    if (-not $secret) {
        return
    }
    Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 3 -Uri "http://127.0.0.1:$port/machine/shutdown" -Headers @{ Authorization = "Bearer $secret" } | Out-Null
}

if ($Action -eq 'check') {
    if (Test-Running) { exit 0 }
    exit 1
}

if ($Action -eq 'remove') {
    if (Get-OwnTask) {
        schtasks.exe /Delete /TN $taskName /F | Out-Null
        Remove-Item -Force (Join-Path $env:LOCALAPPDATA "Ruimte\service\$taskName.xml")
        Remove-Item -Force (Join-Path $env:LOCALAPPDATA "Ruimte\service\$taskName.cmd")
    }
    exit 0
}

# First, or the task starts the daemon again within the minute while the files are being replaced.
$disabled = $false
$task = Get-OwnTask
if ($task -and $task.State -ne 'Disabled') {
    schtasks.exe /Change /TN $taskName /DISABLE | Out-Null
    $disabled = $LASTEXITCODE -eq 0
}

# Before the daemon: a running app starts a daemon it lost. An update's app is already on its way out.
$apps = @(Get-Installed | Where-Object { $_.Path -ieq ($root + 'Ruimte.exe') })
if ($apps.Count -gt 0) {
    Wait-Process -Id $apps.ProcessId -Timeout $appExitSeconds
    # Not the tree: a daemon that is the app's child still gets to stop by itself below.
    $apps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

$daemons = @(Get-Installed | Where-Object { $_.Path -ieq $daemonPath })
foreach ($daemon in $daemons) {
    Request-Shutdown $daemon
}
if ($daemons.Count -gt 0) {
    Wait-Process -Id $daemons.ProcessId -Timeout $daemonStopSeconds
}

foreach ($left in Get-Installed) {
    taskkill.exe /PID $left.ProcessId /T /F | Out-Null
}

if (Test-Running) {
    if ($disabled) { exit 4 }
    exit 2
}
if ($disabled) { exit 3 }
exit 0
