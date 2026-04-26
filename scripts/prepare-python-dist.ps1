param(
  [string]$PythonVersion = "3.12.9",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$root      = Split-Path -Parent $PSScriptRoot
$pyDir     = Join-Path $root "resources\python"
$backDir   = Join-Path $root "resources\backend"
$pyZip     = Join-Path $root "resources\python-embed.zip"
$pyExe     = Join-Path $pyDir "python.exe"
$pthFile   = Join-Path $pyDir "python312._pth"
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"
$getPipPs  = Join-Path $root "resources\get-pip.py"
$embedUrl  = "https://www.python.org/ftp/python/${PythonVersion}/python-${PythonVersion}-embed-amd64.zip"

if (-not $Force -and (Test-Path $pyExe)) {
  Write-Host "[prepare] resources/python/python.exe already exists. Use -Force to rebuild."
  exit 0
}

# 1. Initialize resources directories
if (Test-Path $pyDir)  { Remove-Item $pyDir  -Recurse -Force }
if (Test-Path $backDir){ Remove-Item $backDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pyDir  | Out-Null
New-Item -ItemType Directory -Force -Path $backDir | Out-Null

# 2. Download and expand embeddable Python
Write-Host "[prepare] Downloading Python $PythonVersion embeddable..."
Invoke-WebRequest -Uri $embedUrl -OutFile $pyZip -UseBasicParsing
Expand-Archive -Path $pyZip -DestinationPath $pyDir -Force
Remove-Item $pyZip

# 3. Enable site-packages in python312._pth
$content = Get-Content $pthFile -Raw
$content = $content -replace '#import site', 'import site'
Set-Content $pthFile $content -NoNewline

# 4. Download get-pip.py and install pip
Write-Host "[prepare] Installing pip..."
Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPs -UseBasicParsing
& $pyExe $getPipPs --no-warn-script-location
Remove-Item $getPipPs

# 5. Install backend dependencies into site-packages
$reqFile      = Join-Path $root "backend\requirements.txt"
$sitePackages = Join-Path $pyDir "Lib\site-packages"
Write-Host "[prepare] Installing backend dependencies..."
& $pyExe -m pip install `
  --no-cache-dir `
  --no-warn-script-location `
  -r $reqFile `
  -t $sitePackages

# 6. Copy backend/src/ to resources/backend/src/
Write-Host "[prepare] Copying backend source..."
$srcDir = Join-Path $root "backend\src"
Copy-Item -Path $srcDir -Destination (Join-Path $backDir "src") -Recurse -Force

# 7. Clean up pyc / pycache / test dirs to reduce size
Write-Host "[prepare] Cleaning up..."
Get-ChildItem $pyDir   -Recurse -Include "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $pyDir   -Recurse -Include "*.pyc","*.pyo" | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $backDir -Recurse -Include "__pycache__","tests" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $backDir -Recurse -Include "*.pyc","*.pyo" | Remove-Item -Force -ErrorAction SilentlyContinue

$pySize   = (Get-ChildItem $pyDir   -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$backSize = (Get-ChildItem $backDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("[prepare] Done. python={0:F0} MB, backend={1:F0} MB" -f $pySize, $backSize)
