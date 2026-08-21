<#
.SYNOPSIS
    Start, stop and inspect the four services Lumen needs.

.DESCRIPTION
    Lumen is not one process. It is a browser talking to a proxy that holds the
    control token, talking to S17Code, talking to glc_v5, plus Ollama for
    embeddings. They come up in that order and each one is useless until the one
    below it answers, so this waits for health rather than sleeping and hoping.

.EXAMPLE
    .\lumen.ps1 start
    .\lumen.ps1 status
    .\lumen.ps1 doctor      # checks prerequisites and today's API quota
    .\lumen.ps1 logs s17
    .\lumen.ps1 stop
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'doctor', 'arm')]
    [string]$Command = 'status',

    [Parameter(Position = 1)]
    [string]$Service,

    # Skip the browser-facing dev server. Useful for recording runs headlessly.
    [switch]$NoWeb
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Workspace = Split-Path -Parent $Root
$LogDir = Join-Path $Root '.logs'
$StateFile = Join-Path $Root '.lumen-state.json'

# --------------------------------------------------------------- the services
# Ordered bottom-up: nothing starts until what it depends on is answering.
$Services = @(
    [pscustomobject]@{
        Key = 'ollama'; Name = 'Ollama'; Port = 11434
        Cwd = $Workspace
        Exe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"; Args = @('serve')
        Health = 'http://127.0.0.1:11434/api/tags'
        Note = 'embeddings only'
    },
    [pscustomobject]@{
        Key = 'glc'; Name = 'glc_v5 gateway'; Port = 8111
        Cwd = Join-Path $Workspace 'glc_v5'
        Exe = 'uv'; Args = @('run', 'glc', 'serve')
        Health = 'http://127.0.0.1:8111/healthz'
        Note = 'holds the provider keys'
    },
    [pscustomobject]@{
        Key = 's17'; Name = 'S17Code'; Port = 8113
        Cwd = Join-Path $Workspace 'S17Code'
        Exe = 'uv'; Args = @('run', 's17code', 'serve')
        Health = 'http://127.0.0.1:8113/healthz'
        Note = 'the agent runtime'
    },
    [pscustomobject]@{
        Key = 'proxy'; Name = 'Lumen proxy'; Port = 8115
        Cwd = Join-Path $Root 'server'
        Exe = 'uv'; Args = @('run', '--project', '../../S17Code', 'python', 'run.py')
        Health = 'http://127.0.0.1:8115/api/health'
        Note = 'holds the control token'
    },
    [pscustomobject]@{
        Key = 'web'; Name = 'Vite dev server'; Port = 5173
        Cwd = Join-Path $Root 'web'
        Exe = 'npm'; Args = @('run', 'dev')
        Health = 'http://127.0.0.1:5173/'
        Note = 'the browser UI'
    }
)

# ----------------------------------------------------------------- appearance
$Palette = @{ ok = 'Green'; bad = 'Red'; warn = 'Yellow'; dim = 'DarkGray'; hi = 'Cyan' }

function Write-Rule {
    param([string]$Title)
    $line = '─' * 62
    if ($Title) {
        Write-Host ''
        Write-Host "  $Title" -ForegroundColor $Palette.hi
        Write-Host "  $line" -ForegroundColor $Palette.dim
    }
    else {
        Write-Host "  $line" -ForegroundColor $Palette.dim
    }
}

function Write-Row {
    param([string]$Name, [string]$State, [string]$Colour, [string]$Detail)
    if ($State -in @('up', 'ok', 'stopped')) { $dot = '●' }
    elseif ($State -in @('down', 'missing', 'failed', 'timeout')) { $dot = '○' }
    else { $dot = '◐' }
    Write-Host '  ' -NoNewline
    Write-Host $dot -NoNewline -ForegroundColor $Colour
    Write-Host ('  {0,-18}' -f $Name) -NoNewline
    Write-Host ('{0,-8}' -f $State) -NoNewline -ForegroundColor $Colour
    Write-Host $Detail -ForegroundColor $Palette.dim
}

# ------------------------------------------------------------------- plumbing
function Resolve-Exe {
    <#
        Start-Process needs something Windows can actually execute. `npm` on
        PATH resolves to npm.ps1, which is a script, not an image — hence
        "%1 is not a valid Win32 application". Prefer the .cmd/.exe shim.
    #>
    param([string]$Name)

    if (Test-Path $Name) { return $Name }          # already an absolute path
    foreach ($ext in @('.cmd', '.exe', '.bat')) {
        $found = Get-Command ($Name + $ext) -ErrorAction SilentlyContinue
        if ($found) { return $found.Source }
    }
    $any = Get-Command $Name -ErrorAction SilentlyContinue
    if ($any -and $any.Source -and $any.Source -notmatch '\.ps1$') { return $any.Source }
    return $Name
}

function Test-Health {
    param([string]$Url, [int]$TimeoutSec = 4)
    try {
        $null = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing
        return $true
    }
    catch {
        return $false
    }
}

function Get-PortOwner {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $null }
    return ($conn | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Read-State {
    if (Test-Path $StateFile) {
        try { return Get-Content $StateFile -Raw | ConvertFrom-Json } catch { return $null }
    }
    return $null
}

function Write-State {
    param($Map)
    $Map | ConvertTo-Json -Depth 4 | Out-File -FilePath $StateFile -Encoding utf8
}

function Start-One {
    param($Svc)

    if (Test-Health -Url $Svc.Health -TimeoutSec 2) {
        Write-Row $Svc.Name 'up' $Palette.ok "already listening on $($Svc.Port)"
        return $null
    }

    $owner = Get-PortOwner -Port $Svc.Port
    if ($owner) {
        Write-Row $Svc.Name 'busy' $Palette.warn "port $($Svc.Port) held by PID $owner but not healthy"
        return $null
    }

    if ($Svc.Key -eq 'ollama' -and -not (Test-Path $Svc.Exe)) {
        Write-Row $Svc.Name 'skip' $Palette.warn 'not installed; embeddings will fail'
        return $null
    }

    $exe = Resolve-Exe -Name $Svc.Exe
    if (-not (Test-Path $exe) -and -not (Get-Command $exe -ErrorAction SilentlyContinue)) {
        Write-Row $Svc.Name 'missing' $Palette.bad "cannot find '$($Svc.Exe)' on PATH"
        return $null
    }

    $out = Join-Path $LogDir "$($Svc.Key).log"
    $err = Join-Path $LogDir "$($Svc.Key).err.log"
    $proc = Start-Process -FilePath $exe -ArgumentList $Svc.Args -WorkingDirectory $Svc.Cwd `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru

    # Health, not a sleep. A service that never answers is a failure to report,
    # not a delay to absorb.
    $deadline = (Get-Date).AddSeconds(75)
    while ((Get-Date) -lt $deadline) {
        if (Test-Health -Url $Svc.Health -TimeoutSec 2) {
            Write-Row $Svc.Name 'up' $Palette.ok "port $($Svc.Port) · pid $($proc.Id) · $($Svc.Note)"
            return $proc.Id
        }
        if ($proc.HasExited) {
            Write-Row $Svc.Name 'failed' $Palette.bad "exited $($proc.ExitCode) — see .logs\$($Svc.Key).err.log"
            return $null
        }
        Start-Sleep -Milliseconds 700
    }

    Write-Row $Svc.Name 'timeout' $Palette.bad "no health after 75s — see .logs\$($Svc.Key).err.log"
    return $null
}

function Stop-One {
    param($Svc)
    $stopped = $false
    $owner = Get-PortOwner -Port $Svc.Port
    if ($owner) {
        foreach ($processId in $owner) {
            try { Stop-Process -Id $processId -Force -ErrorAction Stop; $stopped = $true } catch {}
        }
    }
    if ($stopped) {
        Write-Row $Svc.Name 'stopped' $Palette.dim "port $($Svc.Port) released"
    }
    else {
        Write-Row $Svc.Name 'down' $Palette.dim 'was not running'
    }
}

# ------------------------------------------------------------------- commands
function Invoke-Start {
    if (-not (Test-Path $LogDir)) { $null = New-Item -ItemType Directory -Path $LogDir -Force }

    Write-Rule 'Starting Lumen'
    $state = @{}
    foreach ($svc in $Services) {
        if ($NoWeb -and $svc.Key -eq 'web') {
            Write-Row $svc.Name 'skip' $Palette.dim '-NoWeb'
            continue
        }
        $processId = Start-One -Svc $svc
        if ($processId) { $state[$svc.Key] = $processId }
    }
    Write-State $state

    Write-Rule
    Write-Host '  Open ' -NoNewline
    Write-Host 'http://127.0.0.1:5173' -ForegroundColor $Palette.hi -NoNewline
    Write-Host '   ·  logs in .\.logs\   ·  stop with ' -NoNewline -ForegroundColor $Palette.dim
    Write-Host '.\lumen.ps1 stop' -ForegroundColor $Palette.hi
    Write-Host ''
}

function Invoke-Stop {
    Write-Rule 'Stopping Lumen'
    # Reverse order: take the browser-facing end down before what it depends on.
    for ($i = $Services.Count - 1; $i -ge 0; $i--) {
        Stop-One -Svc $Services[$i]
    }
    if (Test-Path $StateFile) { Remove-Item $StateFile -Force }
    Write-Host ''
}

function Invoke-Status {
    Write-Rule 'Lumen'
    $anyDown = $false
    foreach ($svc in $Services) {
        if (Test-Health -Url $svc.Health -TimeoutSec 3) {
            $owner = Get-PortOwner -Port $svc.Port
            $pidText = if ($owner) { "pid $($owner -join ',')" } else { 'pid ?' }
            Write-Row $svc.Name 'up' $Palette.ok "port $($svc.Port) · $pidText · $($svc.Note)"
        }
        else {
            $anyDown = $true
            Write-Row $svc.Name 'down' $Palette.bad "port $($svc.Port) · $($svc.Note)"
        }
    }
    Write-Rule
    if ($anyDown) {
        Write-Host '  Not everything is up. ' -NoNewline -ForegroundColor $Palette.warn
        Write-Host '.\lumen.ps1 start' -ForegroundColor $Palette.hi
    }
    else {
        Write-Host '  All four services answering. ' -NoNewline -ForegroundColor $Palette.ok
        Write-Host 'http://127.0.0.1:5173' -ForegroundColor $Palette.hi
    }
    Write-Host ''
}

function Invoke-Logs {
    if (-not $Service) {
        Write-Host ''
        Write-Host '  Which service? ' -NoNewline -ForegroundColor $Palette.warn
        Write-Host (($Services | ForEach-Object { $_.Key }) -join ', ') -ForegroundColor $Palette.hi
        Write-Host ''
        return
    }
    $match = $Services | Where-Object { $_.Key -eq $Service }
    if (-not $match) {
        Write-Host "  no service called '$Service'" -ForegroundColor $Palette.bad
        return
    }
    foreach ($file in @("$($match.Key).log", "$($match.Key).err.log")) {
        $path = Join-Path $LogDir $file
        if (Test-Path $path) {
            Write-Rule $file
            Get-Content $path -Tail 40
        }
    }
    Write-Host ''
}

function Invoke-Doctor {
    Write-Rule 'Prerequisites'
    foreach ($tool in @('uv', 'node', 'npm', 'git')) {
        $found = Get-Command $tool -ErrorAction SilentlyContinue
        if ($found) { Write-Row $tool 'ok' $Palette.ok $found.Source }
        else { Write-Row $tool 'missing' $Palette.bad 'not on PATH' }
    }
    $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $ollama) { Write-Row 'ollama' 'ok' $Palette.ok $ollama }
    else { Write-Row 'ollama' 'missing' $Palette.warn 'embeddings will fail' }

    Write-Rule 'Configuration'
    foreach ($pair in @(
            @{ n = 'glc_v5\.env'; p = Join-Path $Workspace 'glc_v5\.env' },
            @{ n = 'S17Code\.env'; p = Join-Path $Workspace 'S17Code\.env' })) {
        if (Test-Path $pair.p) { Write-Row $pair.n 'ok' $Palette.ok 'present' }
        else { Write-Row $pair.n 'missing' $Palette.bad 'copy from .env.example' }
    }

    $s17env = Join-Path $Workspace 'S17Code\.env'
    if (Test-Path $s17env) {
        $token = Select-String -Path $s17env -Pattern '^S17_CONTROL_TOKEN=.+' -Quiet
        if ($token) { Write-Row 'control token' 'ok' $Palette.ok 'set (value not shown)' }
        else { Write-Row 'control token' 'missing' $Palette.bad 'every write path answers 503 without it' }

        $guard = Select-String -Path $s17env -Pattern '^S17_PROTECTED_PATHS=' -ErrorAction SilentlyContinue
        if ($guard) {
            $count = ($guard.Line -split '=', 2)[1].Split(',').Count
            if ($count -lt 12) {
                Write-Row 'protected paths' 'narrow' $Palette.warn "$count patterns — DEFAULT_PROTECTED has 12"
            }
            else {
                Write-Row 'protected paths' 'ok' $Palette.ok "$count patterns"
            }
        }
    }

    # The constraint that actually stops the demo: 20 requests per day, per
    # model, and the keys share one project so rotation buys nothing.
    Write-Rule 'Gemini quota (20/day per model, per project)'
    $glcEnv = Join-Path $Workspace 'glc_v5\.env'
    if (-not (Test-Path $glcEnv)) {
        Write-Host '  no glc_v5\.env to read keys from' -ForegroundColor $Palette.warn
    }
    else {
        $model = 'gemini-2.5-flash'
        $modelLine = Select-String -Path $glcEnv -Pattern '^GEMINI_MODEL=(.+)$' -ErrorAction SilentlyContinue
        if ($modelLine) { $model = ($modelLine.Line -split '=', 2)[1].Trim() }

        $keyLine = Select-String -Path $glcEnv -Pattern '^GEMINI_API_KEY_1=(.+)$' -ErrorAction SilentlyContinue
        if (-not $keyLine) {
            Write-Host '  no GEMINI_API_KEY_1 in glc_v5\.env' -ForegroundColor $Palette.warn
        }
        else {
            $key = ($keyLine.Line -split '=', 2)[1].Trim()
            $uri = "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
            $body = '{"contents":[{"parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":8}}'
            try {
                $null = Invoke-WebRequest -Uri $uri -Method Post -TimeoutSec 25 -UseBasicParsing `
                    -Headers @{ 'x-goog-api-key' = $key; 'Content-Type' = 'application/json' } -Body $body
                Write-Row $model 'ok' $Palette.ok 'quota available on key 1'
            }
            catch {
                Write-Row $model 'exhausted' $Palette.warn 'switch GEMINI_MODEL to another bucket'
            }
        }
    }
    Write-Host ''
}

function Invoke-Arm {
    <#
        Put the demo bug back so the red-to-green run can be recorded again.

        The agent fixes average.py, which means the second take would start from
        green and show nothing. This restores the bug and proves the test is red
        before you hit record — a demo that silently starts green is the same
        class of mistake as a green check on a control that never ran.
    #>
    $ws = $env:S17_WORKSPACE
    if (-not $ws) {
        $envFile = Join-Path (Split-Path -Parent $Root) 'S17Code\.env'
        if (Test-Path $envFile) {
            $line = Select-String -Path $envFile -Pattern '^S17_WORKSPACE=(.+)$' -ErrorAction SilentlyContinue
            if ($line) { $ws = ($line.Line -split '=', 2)[1].Trim() }
        }
    }
    if (-not $ws -or -not (Test-Path $ws)) {
        Write-Host '  cannot find S17_WORKSPACE' -ForegroundColor $Palette.bad
        return
    }

    Write-Rule 'Arming the red-to-green demo'

    $buggy = @'
def average(numbers):
    """Mean of a list. Returns 0 for an empty list."""
    return sum(numbers) / len(numbers)
'@
    Set-Content -Path (Join-Path $ws 'average.py') -Value $buggy -Encoding utf8
    Write-Row 'average.py' 'ok' $Palette.ok 'bug restored: raises on an empty list'

    $testFile = Join-Path $ws 'tests\test_average.py'
    if (Test-Path $testFile) {
        Write-Row 'the test' 'ok' $Palette.ok 'tests/test_average.py — protected from the agent'
    }
    else {
        Write-Row 'the test' 'missing' $Palette.bad 'tests/test_average.py is required'
        return
    }

    # Prove it is red, rather than assuming.
    $pytest = Join-Path (Split-Path -Parent $Root) 'S17Code\.venv\Scripts\pytest.exe'
    if (Test-Path $pytest) {
        Push-Location $ws
        $out = & $pytest 'tests/test_average.py' '-q' 2>&1 | Out-String
        Pop-Location
        if ($out -match '(\d+) failed') {
            Write-Row 'pytest' 'red' $Palette.warn ($out -split "`n" | Where-Object { $_ -match 'failed' } | Select-Object -Last 1).Trim()
        }
        else {
            Write-Row 'pytest' 'not red' $Palette.bad 'the demo will show nothing — check the fixture'
        }
    }

    Write-Rule
    $global:LASTEXITCODE = 0
    Write-Host '  Now ask Lumen: ' -NoNewline -ForegroundColor $Palette.dim
    Write-Host '"The test tests/test_average.py is failing. Run pytest to see' -ForegroundColor $Palette.hi
    Write-Host '   the failure, then fix average.py so the test passes, then run pytest' -ForegroundColor $Palette.hi
    Write-Host '   again to confirm. Do not modify the test."' -ForegroundColor $Palette.hi
    Write-Host ''
}

switch ($Command) {
    'start' { Invoke-Start }
    'arm' { Invoke-Arm }
    'stop' { Invoke-Stop }
    'restart' { Invoke-Stop; Invoke-Start }
    'status' { Invoke-Status }
    'logs' { Invoke-Logs }
    'doctor' { Invoke-Doctor }
}
