# PowerShell script to flatten docs into Domain Flat Layout and auto-fix relative markdown links
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

$DocsDir = Join-Path $PSScriptRoot ".."
$Domains = @("core", "tools", "frontend", "unisim")
$Layers = @("implementation-plans", "reviews")

Write-Host "=== Step 1: Flattening implementation-plans and reviews ==="

foreach ($layer in $Layers) {
    $layerDir = Join-Path $DocsDir $layer
    if (-not (Test-Path $layerDir)) { continue }

    foreach ($dom in $Domains) {
        $domDir = Join-Path $layerDir $dom
        if (-not (Test-Path $domDir)) {
            New-Item -ItemType Directory -Path $domDir -Force | Out-Null
            continue
        }

        # Check for active and archived directories
        foreach ($subName in @("active", "archived")) {
            $subPath = Join-Path $domDir $subName
            if (Test-Path $subPath) {
                # Get all markdown files and directories inside subPath
                $items = Get-ChildItem -Path $subPath -Recurse -File -Filter "*.md"
                foreach ($item in $items) {
                    $targetPath = Join-Path $domDir $item.Name
                    if ($item.FullName -ne $targetPath) {
                        Write-Host "[$layer/$dom] Moving $($item.Name) -> $domDir"
                        Move-Item -Path $item.FullName -Destination $targetPath -Force
                    }
                }
                # Remove subPath directory tree
                Remove-Item -Path $subPath -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "`n=== Step 2: Indexing all Markdown files under docs/ ==="
$allMdFiles = Get-ChildItem -Path $DocsDir -Recurse -File -Filter "*.md"
$fileMap = @{}
foreach ($file in $allMdFiles) {
    $fileMap[$file.Name] = $file.FullName
}
Write-Host "Indexed $($fileMap.Count) markdown files."

Write-Host "`n=== Step 3: Repairing Markdown relative links ==="
$linkPattern = '\[([^\]]+)\]\(([^)]+)\)'
$fixedCount = 0

foreach ($file in $allMdFiles) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    if ([string]::IsNullOrEmpty($content)) { continue }

    $modified = $false
    $newContent = [regex]::Replace($content, $linkPattern, {
        param($match)
        $label = $match.Groups[1].Value
        $target = $match.Groups[2].Value

        if ($target.StartsWith("http://") -or $target.StartsWith("https://") -or $target.StartsWith("mailto:") -or $target.StartsWith("#")) {
            return $match.Value
        }

        $targetPathPart = $target.Split("#")[0]
        $anchorPart = if ($target.Contains("#")) { "#" + $target.Split("#")[1] } else { "" }

        if (-not $targetPathPart.EndsWith(".md")) {
            return $match.Value
        }

        $dirOfFile = $file.DirectoryName
        try {
            $currentAbs = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($dirOfFile, $targetPathPart))
            if (Test-Path $currentAbs) {
                return $match.Value
            }
        } catch {
            # Invalid path format, continue search
        }

        $targetFilename = [System.IO.Path]::GetFileName($targetPathPart)
        if ($fileMap.ContainsKey($targetFilename)) {
            $newTargetAbs = $fileMap[$targetFilename]
            # Compute relative path
            $fileUri = New-Object System.Uri($file.FullName)
            $targetUri = New-Object System.Uri($newTargetAbs)
            $relUri = $fileUri.MakeRelativeUri($targetUri)
            $newRelPath = [System.Uri]::UnescapeDataString($relUri.ToString()).Replace("\", "/")
            
            $script:fixedCount++
            $script:modified = $true
            Write-Host "Fixed in $($file.Name): $targetPathPart -> $newRelPath"
            return "[$label]($newRelPath$anchorPart)"
        }

        return $match.Value
    })

    if ($modified) {
        Set-Content -Path $file.FullName -Value $newContent -Encoding UTF8
    }
}

Write-Host "`n=== Flatten & Link Repair Complete! Total fixed links: $fixedCount ==="
