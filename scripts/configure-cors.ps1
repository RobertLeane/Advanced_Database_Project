param(
    [string]$CouchUrl = 'http://localhost:5984',
    [string]$AppOrigin = 'http://localhost:5173',
    [PSCredential]$Credential
)

$ErrorActionPreference = 'Stop'
if (-not $Credential) { $Credential = Get-Credential -Message 'CouchDB administrator credentials (not saved)' }
$corsPassword = $Credential.GetNetworkCredential().Password
$corsToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($Credential.UserName):$corsPassword"))
$corsHeaders = @{ Authorization = "Basic $corsToken" }
$configUrl = "$($CouchUrl.TrimEnd('/'))/_node/_local/_config"

try {
    $existing = Invoke-RestMethod -Uri "$configUrl/cors" -Headers $corsHeaders
    $origins = @($existing.origins -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne '*' })
    $origins = @($origins + $AppOrigin | Select-Object -Unique)
    $headers = @($existing.headers -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
    $headers = @($headers + @('accept', 'authorization', 'content-type', 'origin', 'referer') | Select-Object -Unique)
    $methods = @($existing.methods -split ',' | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ })
    $methods = @($methods + @('GET', 'PUT', 'POST', 'HEAD', 'DELETE', 'OPTIONS') | Select-Object -Unique)
    $settings = @{
        'chttpd/enable_cors' = 'true'
        'cors/origins' = $origins -join ','
        'cors/headers' = $headers -join ','
        'cors/methods' = $methods -join ','
    }
    foreach ($setting in $settings.GetEnumerator()) {
        $body = ConvertTo-Json -InputObject ([string]$setting.Value) -Compress
        $null = Invoke-RestMethod -Method Put -Uri "$configUrl/$($setting.Key)" -Headers $corsHeaders -ContentType 'application/json' -Body $body
    }
    Write-Output "CouchDB CORS enabled for $AppOrigin. Existing explicit origins were preserved."
} finally {
    $corsPassword = $null
    $corsToken = $null
    $corsHeaders = $null
    $Credential = $null
}
