param([string]$Destination = (Join-Path $PSScriptRoot '..\dist'))
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
[IO.Directory]::CreateDirectory($destinationPath) | Out-Null
$bundleName = 'JevDuo-Windows-x64'
# A fresh staging directory avoids packaging old files or user settings.
$stage = Join-Path ([IO.Path]::GetTempPath()) ('jev-build-' + [guid]::NewGuid())
$bundle = Join-Path $stage $bundleName
$runtime = Join-Path $bundle 'runtime'
$desktop = Join-Path $bundle 'desktop'
New-Item -ItemType Directory -Path $runtime,$desktop -Force | Out-Null
$node = (Get-Command node.exe).Source
if ((& $node -p 'process.arch') -ne 'x64') { throw 'An x64 Node.js runtime is required.' }
& $node --input-type=module -e "import 'node:sqlite'"
if ($LASTEXITCODE) { throw 'Node.js with node:sqlite support is required.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sourceFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' | ForEach-Object FullName)
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ "/out:$bundle\JevDuo.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll $sourceFiles
if ($LASTEXITCODE) { throw 'Client compilation failed.' }
Copy-Item -LiteralPath $node -Destination $runtime
$nodeVersion = & $node -p 'process.version'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $runtime 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $repo 'src') -Destination $bundle -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bridge.mjs') -Destination $desktop
Copy-Item -LiteralPath (Join-Path $repo 'package.json'),(Join-Path $repo 'LICENSE') -Destination $bundle
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'WINDOWS.md') -Destination $bundle
$archive = Join-Path $destinationPath ($bundleName + '.zip')
Compress-Archive -LiteralPath $bundle -DestinationPath $archive -Force
if ([IO.Path]::GetDirectoryName($stage) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($stage) -like 'jev-build-*') {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
Write-Output $archive
