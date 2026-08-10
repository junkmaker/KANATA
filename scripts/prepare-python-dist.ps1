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

# Python 埋め込み配布の構築(DL + pip install)だけが重い。ここだけ既存ならスキップする。
# **backend のコピーは常に実行する** — スクリプト全体を早期 exit させると、
# backend/src や backend/data を変えても配布へ反映されず、
# check-resources.cjs が案内する `npm run prepare:dist` を実行しても状況が変わらない
# (= 同じエラーで詰む)。CI のキャッシュヒット時に古い src が同梱される事故も同根。
$needPython = $Force -or -not (Test-Path $pyExe)

if ($needPython) {
  # 1. Initialize python resources directory
  if (Test-Path $pyDir) { Remove-Item $pyDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $pyDir | Out-Null

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

  # 5b. Clean up pyc / pycache in the python dist to reduce size
  Write-Host "[prepare] Cleaning up python dist..."
  Get-ChildItem $pyDir -Recurse -Include "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem $pyDir -Recurse -Include "*.pyc","*.pyo" | Remove-Item -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "[prepare] resources/python/python.exe already exists. Skipping Python setup (use -Force to rebuild)."
}

# 6. Rebuild resources/backend from scratch every run
if (Test-Path $backDir) { Remove-Item $backDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $backDir | Out-Null

Write-Host "[prepare] Copying backend source..."
$srcDir = Join-Path $root "backend\src"
Copy-Item -Path $srcDir -Destination (Join-Path $backDir "src") -Recurse -Force

# 6b. Copy bundled CSV masters to resources/backend/data/
# backend_data_dir() が読む読み取り専用リソース(jp_names.csv / *_universe.csv)。
# *.csv に限ること — backend/data には kanata.db と ohlcv/ backtest/ の生成物がある。
Write-Host "[prepare] Copying bundled CSV data..."
$dataDest = Join-Path $backDir "data"
New-Item -ItemType Directory -Force -Path $dataDest | Out-Null
Copy-Item -Path (Join-Path $root "backend\data\*.csv") -Destination $dataDest -Force

# 7. Clean up pyc / pycache / test dirs in the copied backend
Get-ChildItem $backDir -Recurse -Include "__pycache__","tests" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $backDir -Recurse -Include "*.pyc","*.pyo" | Remove-Item -Force -ErrorAction SilentlyContinue

$pySize   = (Get-ChildItem $pyDir   -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$backSize = (Get-ChildItem $backDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("[prepare] Done. python={0:F0} MB, backend={1:F0} MB" -f $pySize, $backSize)
