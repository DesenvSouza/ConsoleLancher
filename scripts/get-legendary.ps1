# Baixa o Legendary (cliente de linha de comando, de código aberto, da Epic Games) para src-tauri\resources\legendary.
# O launcher o usa para instalar, abrir e desinstalar jogos da Epic sem a janela da Epic Games Launcher.
# Fonte: https://github.com/Heroic-Games-Launcher/legendary (GPL-3.0). O launcher só o executa como um programa à parte.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\get-legendary.ps1

$ErrorActionPreference = "Stop"
$version = "0.20.43"
$sha256 = "ec1ad2d19d44e07b2b0330191c300979f102c509f2a889708099f453c5188f20"
$url = "https://github.com/Heroic-Games-Launcher/legendary/releases/download/$version/legendary_windows_x86_64.exe"
$dir = Join-Path $PSScriptRoot "..\src-tauri\resources\legendary"
$target = Join-Path $dir "legendary.exe"

New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest -Uri $url -OutFile $target
$hash = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $sha256) {
    Remove-Item $target -Force
    throw "O arquivo baixado não confere com o esperado (SHA-256 $hash). Apaguei-o."
}
Write-Host "Legendary $version pronto em $target"
