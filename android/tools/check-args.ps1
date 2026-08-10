# Poor man's overload resolution.
#
# Companion to check-imports.ps1, and equally a stopgap for having no JDK on this
# machine. This one catches the second-most-expensive error to find by eye in a
# Compose codebase: calling a composable with a named argument it does not
# declare, which is what happens when two files are written against slightly
# different ideas of the same component's API.
#
# It compares the named arguments at each call site against the parameter names of
# the single top-level function of that name. Functions declared more than once
# (real overloads) are skipped, since picking the right one needs types. Positional
# arguments, types, arity and nullability are all invisible to it.
#
# Delete this once `gradlew compileDebugKotlin` runs.

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$sources = Get-ChildItem -Path $root -Recurse -Filter *.kt -File

# name -> list of parameter-name sets, one per declaration found.
$declarations = @{}

# Comments are stripped before anything else: a KDoc on a parameter sits between
# the comma and the name, and prose commas and brackets inside one would otherwise
# be read as syntax.
function Remove-Comments {
    param([string]$Text)

    $Text = [regex]::Replace($Text, '/\*[\s\S]*?\*/', { "`n" * ($args[0].Value -split "`n").Count })
    # `(?<!:)` keeps the `//` of a URL in a string literal from starting a comment.
    return [regex]::Replace($Text, '(?m)(?<!:)//.*$', '')
}

function Get-BalancedSpan {
    param([string]$Text, [int]$OpenIndex)

    $depth = 0
    for ($i = $OpenIndex; $i -lt $Text.Length; $i++) {
        $c = $Text[$i]
        if ($c -eq '(') { $depth++ }
        elseif ($c -eq ')') {
            $depth--
            if ($depth -eq 0) { return $Text.Substring($OpenIndex + 1, $i - $OpenIndex - 1) }
        }
    }
    return $null
}

# Collect names that appear at nesting depth 0 of the given argument text, i.e.
# skipping anything inside a nested call, lambda, collection or generic.
function Get-TopLevelNames {
    param([string]$Body, [string]$Pattern)

    $names = New-Object 'System.Collections.Generic.HashSet[string]'
    $depth = 0
    $angle = 0
    $start = 0
    $segments = @()
    for ($i = 0; $i -lt $Body.Length; $i++) {
        $c = $Body[$i]
        $previous = if ($i -gt 0) { $Body[$i - 1] } else { [char]0 }
        if ($c -eq '(' -or $c -eq '{' -or $c -eq '[') { $depth++ }
        elseif ($c -eq ')' -or $c -eq '}' -or $c -eq ']') { $depth-- }
        # A `<` only opens a generic when it follows a type name; a `>` only closes
        # one when it is not the tail of a `->` function type.
        elseif ($c -eq '<' -and $previous -match '[\w_]') { $angle++ }
        elseif ($c -eq '>' -and $previous -ne '-' -and $angle -gt 0) { $angle-- }
        elseif ($c -eq ',' -and $depth -eq 0 -and $angle -eq 0) {
            $segments += $Body.Substring($start, $i - $start)
            $start = $i + 1
        }
    }
    $segments += $Body.Substring($start)

    foreach ($segment in $segments) {
        $segment = $segment.TrimStart("`r", "`n", ' ', "`t")
        $m = [regex]::Match($segment, $Pattern)
        if ($m.Success) { [void]$names.Add($m.Groups[1].Value) }
    }
    return $names
}

foreach ($file in $sources) {
    $text = Remove-Comments (Get-Content -LiteralPath $file.FullName -Raw)
    foreach ($m in [regex]::Matches($text, '(?m)^(?:public |internal |private |inline |suspend )*fun\s+(?:<[^>]+>\s+)?(?:[\w\.]+\.)?([A-Za-z_]\w*)\s*\(')) {
        $name = $m.Groups[1].Value
        $open = $text.IndexOf('(', $m.Index)
        $body = Get-BalancedSpan -Text $text -OpenIndex $open
        if ($null -eq $body) { continue }

        # Parameters look like `name: Type = default`, optionally annotated.
        $params = Get-TopLevelNames -Body $body -Pattern '^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:vararg\s+)?([A-Za-z_]\w*)\s*:'
        if (-not $declarations.ContainsKey($name)) { $declarations[$name] = @() }
        $declarations[$name] += ,$params
    }
}

$single = @{}
foreach ($name in $declarations.Keys) {
    if ($declarations[$name].Count -eq 1) { $single[$name] = $declarations[$name][0] }
}

$problems = @()
foreach ($file in $sources) {
    $text = Remove-Comments (Get-Content -LiteralPath $file.FullName -Raw)
    foreach ($m in [regex]::Matches($text, '(?<![\w\.])([A-Z][A-Za-z0-9_]*)\s*\(')) {
        $name = $m.Groups[1].Value
        if (-not $single.ContainsKey($name)) { continue }

        # Skip the declaration itself.
        $lineStart = $text.LastIndexOf("`n", $m.Index) + 1
        $prefix = $text.Substring($lineStart, $m.Index - $lineStart)
        if ($prefix -match '\bfun\s+$') { continue }

        $open = $text.IndexOf('(', $m.Index)
        $body = Get-BalancedSpan -Text $text -OpenIndex $open
        if ($null -eq $body) { continue }

        $used = Get-TopLevelNames -Body $body -Pattern '^\s*([A-Za-z_]\w*)\s*=(?!=)'
        foreach ($argument in $used) {
            if (-not $single[$name].Contains($argument)) {
                $problems += [pscustomobject]@{
                    File = $file.FullName.Replace("$root\", '')
                    Call = "$name(… $argument = …)"
                    Declares = ($single[$name] -join ', ')
                }
            }
        }
    }
}

if ($problems.Count -eq 0) {
    Write-Output 'OK: every named argument at every call site is declared by the callee.'
} else {
    Write-Output "$($problems.Count) argument-name mismatch(es):"
    $problems | Sort-Object File, Call | Format-Table -AutoSize -Wrap | Out-String -Width 240 | Write-Output
    exit 1
}
