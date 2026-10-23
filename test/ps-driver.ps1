# Runs ask.ps1 against vectors.json as the agent (A) and prints results as JSON for crypto.test.ts.
param([string]$Vectors)
. "$PSScriptRoot\..\skill\ask.ps1"

$v = [IO.File]::ReadAllText((Resolve-Path $Vectors), [Text.Encoding]::UTF8) | ConvertFrom-Json
$b64 = { param($s) , [Convert]::FromBase64String($s) }
$pubA = & $b64 $v.pubA
$pubB = & $b64 $v.pubB
$token = ConvertFrom-AskuHex $v.token
$blob = [byte[]](@(0x45, 0x43, 0x4B, 0x32, 32, 0, 0, 0) + $pubA[1..64] + (ConvertFrom-AskuHex $v.privA)) # 'ECK2', cbKey=32, X, Y, d
$keys = Get-AskuKeys $blob $pubB

$badBind = & $b64 $v.bind
$badBind[0] = $badBind[0] -bxor 1

$messages = foreach ($m in $v.messages) {
    $bad = & $b64 $m.tag
    $bad[0] = $bad[0] -bxor 1
    $tampered = [pscustomobject]@{ v = 1; iv = $m.iv; ct = $m.ct; tag = [Convert]::ToBase64String($bad) }
    $rejected = $false
    try { $null = Unprotect-AskuMessage $keys $v.sid $m.dir $m.seq $tampered } catch { $rejected = $true }
    [ordered]@{
        sealed = Protect-AskuMessage $keys $v.sid $m.dir $m.seq ([Text.Encoding]::UTF8.GetBytes($m.pt)) (& $b64 $m.iv)
        opened = [Convert]::ToBase64String((Unprotect-AskuMessage $keys $v.sid $m.dir $m.seq $m))
        rejected = $rejected
    }
}

[ordered]@{
    K = ConvertTo-AskuHex $keys.K
    kEnc = ConvertTo-AskuHex $keys.Enc
    kMac = ConvertTo-AskuHex $keys.Mac
    fragment = Get-AskuFragment $pubA $token
    bindOk = Test-AskuBind $token $pubB (& $b64 $v.bind)
    badBindOk = Test-AskuBind $token $pubB $badBind
    messages = @($messages)
} | ConvertTo-Json -Depth 5 -Compress
