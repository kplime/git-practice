param([string]$AdminUser = 'postgres')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$oldPassword = $env:WIFI_CSI_ADMIN_PASSWORD
$oldUser = $env:WIFI_CSI_ADMIN_USER
$securePassword = Read-Host 'Local PostgreSQL administrator password (not saved)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:WIFI_CSI_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:WIFI_CSI_ADMIN_USER = $AdminUser
    Push-Location -LiteralPath $projectPath
    try {
        & node --env-file-if-exists=.env scripts/rename-db.js
        $renameExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $env:WIFI_CSI_ADMIN_PASSWORD = $oldPassword
    $env:WIFI_CSI_ADMIN_USER = $oldUser
}
exit $renameExitCode
