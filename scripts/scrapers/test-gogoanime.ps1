# Test gogoanime extraction using PowerShell
# Usage: .\scripts\test-gogoanime.ps1 "https://gogoanime.me.uk/episode/one-piece-episode-1"

param(
    [Parameter(Mandatory=$true)]
    [string]$GogoanimeUrl
)

Write-Host "🔍 Testing gogoanime URL extraction..." -ForegroundColor Cyan
Write-Host "📍 URL: $GogoanimeUrl" -ForegroundColor Yellow
Write-Host ""

$body = @{
    gogoanimeUrl = $GogoanimeUrl
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/api/test-gogoanime-extract" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body

    if ($response.success) {
        Write-Host "✅ Extraction successful!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📊 Results:" -ForegroundColor Cyan
        Write-Host "   HTML Length: $($response.htmlLength)"
        Write-Host "   Megaplay URLs: $($response.results.megaplayUrls.Count)"
        Write-Host "   Total iframes: $($response.results.allIframeUrls.Count)"
        Write-Host "   Other videos: $($response.results.otherVideoUrls.Count)"
        Write-Host ""

        if ($response.results.megaplayUrls.Count -gt 0) {
            Write-Host "🎯 MEGAPLAY URLs:" -ForegroundColor Green
            $i = 1
            foreach ($url in $response.results.megaplayUrls) {
                Write-Host "   $i. $url"
                $i++
            }
            Write-Host ""
        }

        if ($response.results.allIframeUrls.Count -gt 0) {
            Write-Host "📺 All Iframe URLs:" -ForegroundColor Yellow
            $i = 1
            foreach ($url in $response.results.allIframeUrls) {
                Write-Host "   $i. $url"
                $i++
            }
            Write-Host ""
        }

        if ($response.recommended) {
            Write-Host "💡 RECOMMENDED VIDEO URL:" -ForegroundColor Magenta
            Write-Host "    $($response.recommended)"
        }

    } else {
        Write-Host "❌ Extraction failed: $($response.error)" -ForegroundColor Red
        if ($response.details) {
            Write-Host "   Details: $($response.details)" -ForegroundColor Red
        }
    }

} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Make sure the server is running on port 3001" -ForegroundColor Yellow
}
