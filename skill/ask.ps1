# asku agent client. PowerShell 5.1 + .NET Framework only. Keep this file ASCII: PS 5.1 reads BOM-less files as ANSI.
param([string]$Command, [string]$File)
$ErrorActionPreference = 'Stop'
$Version = '1.0.0' # keep in step with ask.sh

function ConvertTo-AskuHex([byte[]]$Bytes) { [BitConverter]::ToString($Bytes).Replace('-', '').ToLower() }

function ConvertFrom-AskuHex([string]$Hex) {
    $out = New-Object byte[] ($Hex.Length / 2)
    for ($i = 0; $i -lt $out.Length; $i++) { $out[$i] = [Convert]::ToByte($Hex.Substring($i * 2, 2), 16) }
    , $out
}

function Get-AskuHmac([byte[]]$Key, [byte[]]$Msg) {
    $h = New-Object Security.Cryptography.HMACSHA256 (, $Key)
    try { , $h.ComputeHash($Msg) } finally { $h.Dispose() }
}

function Get-AskuSha256([byte[]]$Msg) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { , $h.ComputeHash($Msg) } finally { $h.Dispose() }
}

function Test-AskuEqual([byte[]]$A, [byte[]]$B) {
    if ($A.Length -ne $B.Length) { return $false }
    $diff = 0
    for ($i = 0; $i -lt $A.Length; $i++) { $diff = $diff -bor ($A[$i] -bxor $B[$i]) }
    $diff -eq 0
}

function New-AskuAes([byte[]]$Key, [byte[]]$Iv) {
    $aes = New-Object Security.Cryptography.AesCryptoServiceProvider
    $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'; $aes.Key = $Key; $aes.IV = $Iv
    $aes
}

# PrivateBlob: CNG EccPrivateBlob. PeerPub: raw 65-byte uncompressed point.
function Get-AskuKeys([byte[]]$PrivateBlob, [byte[]]$PeerPub) {
    if ($PeerPub.Length -ne 65 -or $PeerPub[0] -ne 4) { throw 'asku: bad public key' }
    $fmt = [Security.Cryptography.CngKeyBlobFormat]
    $ecdh = New-Object Security.Cryptography.ECDiffieHellmanCng ([Security.Cryptography.CngKey]::Import($PrivateBlob, $fmt::EccPrivateBlob))
    # Hash KDF with SHA256 and no prepend/append is exactly K = SHA256(Z)
    $ecdh.KeyDerivationFunction = [Security.Cryptography.ECDiffieHellmanKeyDerivationFunction]::Hash
    $ecdh.HashAlgorithm = [Security.Cryptography.CngAlgorithm]::Sha256
    $blob = [byte[]](@(0x45, 0x43, 0x4B, 0x31, 32, 0, 0, 0) + $PeerPub[1..64]) # 'ECK1', cbKey=32, X, Y
    $k = $ecdh.DeriveKeyMaterial([Security.Cryptography.ECDiffieHellmanCngPublicKey]::FromByteArray($blob, $fmt::EccPublicBlob))
    $ecdh.Dispose()
    $ascii = [Text.Encoding]::ASCII
    @{ K = $k; Enc = (Get-AskuHmac $k $ascii.GetBytes('enc')); Mac = (Get-AskuHmac $k $ascii.GetBytes('mac')) }
}

function Get-AskuTag([byte[]]$Mac, [string]$Sid, [string]$Dir, [int]$Seq, [byte[]]$Iv, [byte[]]$Ct) {
    Get-AskuHmac $Mac ([byte[]]([Text.Encoding]::UTF8.GetBytes("v1|$Sid|$Dir|$Seq|") + $Iv + $Ct))
}

function Protect-AskuMessage($Keys, [string]$Sid, [string]$Dir, [int]$Seq, [byte[]]$Plain, [byte[]]$Iv) {
    if (-not $Iv) { $Iv = New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Iv) }
    $aes = New-AskuAes $Keys.Enc $Iv
    $ct = $aes.CreateEncryptor().TransformFinalBlock($Plain, 0, $Plain.Length)
    $aes.Dispose()
    [ordered]@{
        v = 1; seq = $Seq; dir = $Dir
        iv = [Convert]::ToBase64String($Iv)
        ct = [Convert]::ToBase64String($ct)
        tag = [Convert]::ToBase64String((Get-AskuTag $Keys.Mac $Sid $Dir $Seq $Iv $ct))
    }
}

# Dir and Seq are what the caller expects, never read from the envelope: a replayed or reflected envelope fails the tag.
function Unprotect-AskuMessage($Keys, [string]$Sid, [string]$Dir, [int]$Seq, $Envelope) {
    $iv = [Convert]::FromBase64String($Envelope.iv)
    $ct = [Convert]::FromBase64String($Envelope.ct)
    if ($Envelope.v -ne 1 -or -not (Test-AskuEqual (Get-AskuTag $Keys.Mac $Sid $Dir $Seq $iv $ct) ([Convert]::FromBase64String($Envelope.tag)))) {
        throw 'asku: bad tag'
    }
    $aes = New-AskuAes $Keys.Enc $iv
    try { , $aes.CreateDecryptor().TransformFinalBlock($ct, 0, $ct.Length) } finally { $aes.Dispose() }
}

function Get-AskuFragment([byte[]]$PubA, [byte[]]$Token) {
    '{0}.{1}' -f (ConvertTo-AskuHex (Get-AskuSha256 $PubA)), (ConvertTo-AskuHex $Token)
}

function Test-AskuBind([byte[]]$Token, [byte[]]$PubB, [byte[]]$Bind) { Test-AskuEqual (Get-AskuHmac $Token $PubB) $Bind }

# The agent's binding when it joins a browser-created session: HMAC(T, pubA), base64.
function Get-AskuBindMac([byte[]]$Token, [byte[]]$Pub) { [Convert]::ToBase64String((Get-AskuHmac $Token $Pub)) }

# ---- CLI ----------------------------------------------------------------------------------------
if ($MyInvocation.InvocationName -eq '.') { return } # dot-sourced (tests): functions only

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$Root = if ($env:ASKU_HOME) { $env:ASKU_HOME } else { Join-Path $env:USERPROFILE '.asku' }
$S = Join-Path $Root $(if ($env:ASKU_SESSION) { $env:ASKU_SESSION } else { 'default' })
$urlFile = Join-Path $S 'url' # a joined session lives on its link's relay
$Base = if (Test-Path $urlFile) { [IO.File]::ReadAllText($urlFile).Trim() } elseif ($env:ASKU_URL) { $env:ASKU_URL } else { 'https://asku.dev' }
$WaitSec = if ($env:ASKU_WAIT) { [int]$env:ASKU_WAIT } else { 500 } # no new poll after this; agent tool timeouts are ~600s

function Fail([string]$Msg) { [Console]::Error.WriteLine("asku: $Msg"); exit 1 }
function Pending([string]$Msg) { [Console]::Out.Write("PENDING`n$Msg`nRun again to keep waiting: $PSCommandPath wait`n"); exit 2 }
function Get-State([string]$Name, $Default = $null) { $p = Join-Path $S $Name; if (Test-Path $p) { [IO.File]::ReadAllText($p).Trim() } else { $Default } }
function Set-State([string]$Name, $Value) { [IO.File]::WriteAllText((Join-Path $S $Name), "$Value") }
function Remove-Session { if (Test-Path $S) { Remove-Item -Recurse -Force $S } }

# Returns @{ Code; Body }, or $null on network errors.
function Invoke-AskuRequest([string]$Method, [string]$Path, [string]$Body) {
    $r = [Net.HttpWebRequest]::Create("$Base$Path")
    $r.Method = $Method; $r.Timeout = 40000; $r.ReadWriteTimeout = 40000; $r.ContentType = 'application/json'
    $key = Get-State 'key'
    if ($key) { $r.Headers['Authorization'] = "Bearer $key" }
    try {
        if ($Body) {
            $b = [Text.Encoding]::UTF8.GetBytes($Body)
            $s = $r.GetRequestStream(); $s.Write($b, 0, $b.Length); $s.Close()
        }
        $resp = $r.GetResponse()
    } catch {
        $e = $_.Exception
        while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
        if (-not $e -or -not $e.Response) { return $null }
        $resp = $e.Response
    }
    try { @{ Code = [int]$resp.StatusCode; Body = (New-Object IO.StreamReader ($resp.GetResponseStream(), [Text.Encoding]::UTF8)).ReadToEnd() } }
    finally { $resp.Close() }
}

function New-AskuKey {
    New-Item -ItemType Directory -Force $S | Out-Null
    $p = New-Object Security.Cryptography.CngKeyCreationParameters
    $p.ExportPolicy = [Security.Cryptography.CngExportPolicies]::AllowPlaintextExport
    # [NullString]: a plain $null becomes '' and creates a persisted key named '' in the user's key store
    $k = [Security.Cryptography.CngKey]::Create([Security.Cryptography.CngAlgorithm]::ECDiffieHellmanP256, [NullString]::Value, $p)
    if (-not $k.IsEphemeral) { throw 'asku: expected an ephemeral key' }
    $blob = $k.Export([Security.Cryptography.CngKeyBlobFormat]::EccPrivateBlob)
    $k.Dispose()
    Set-State 'priv' ([Convert]::ToBase64String($blob))
    Set-State 'pub' ([Convert]::ToBase64String([byte[]](@(4) + $blob[8..71])))
    Set-State 'url' $Base
}

function Start-AskuSession {
    if (Test-Path (Join-Path $S 'sid')) { return }
    New-AskuKey
    $t = New-Object byte[] 16
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($t)
    Set-State 'T' (ConvertTo-AskuHex $t)
    $r = Invoke-AskuRequest POST '/s' ('{"pub":"' + (Get-State 'pub') + '"}')
    if (-not $r) { Remove-Session; Fail "relay unreachable: $Base" }
    if ($r.Code -ne 201) { Remove-Session; Fail "create failed ($($r.Code)): $($r.Body)" }
    $j = $r.Body | ConvertFrom-Json
    Set-State 'sid' $j.sid
    Set-State 'key' $j.key
}

# Joins a session the user started on the website. Resume-Asku then prints their opening note.
function Join-AskuSession([string]$Link) {
    if (Test-Path (Join-Path $S 'sid')) { Fail "session is in use; run: $PSCommandPath close, or set ASKU_SESSION" }
    if ($Link -notmatch '^(https?://[^/#]+)/j/([A-Za-z0-9_-]{22})#([0-9a-f]{64})\.([0-9a-f]{32})$') { Fail "not an asku agent link: $Link" }
    $script:Base = $Matches[1]
    $sid = $Matches[2]; $hash = $Matches[3]; $token = ConvertFrom-AskuHex $Matches[4]
    $r = Invoke-AskuRequest GET "/s/$sid"
    if (-not $r) { Fail "relay unreachable: $Base" }
    if ($r.Code -ne 200) { Fail "session not found ($($r.Code)); ask the user for a new link" }
    $j = $r.Body | ConvertFrom-Json
    if ($j.role -ne 'browser') { Fail 'that is a link for the user, not for the agent' }
    $peer = [Convert]::FromBase64String($j.pub)
    if ((ConvertTo-AskuHex (Get-AskuSha256 $peer)) -ne $hash) { Fail "the link doesn't match its session; ask the user for a new one" }
    New-AskuKey
    $mine = [Convert]::FromBase64String((Get-State 'pub'))
    $r = Invoke-AskuRequest POST "/s/$sid/bind" ('{"pub":"' + (Get-State 'pub') + '","mac":"' + (Get-AskuBindMac $token $mine) + '"}')
    if (-not $r) { Remove-Session; Fail "relay unreachable: $Base" }
    if ($r.Code -ne 201) { Remove-Session; Fail "join failed ($($r.Code)): $($r.Body)" } # 409: someone already joined
    Set-State 'sid' $sid
    Set-State 'key' ($r.Body | ConvertFrom-Json).key
    Set-State 'peer' $j.pub
    Set-State 'seq' 0
    Set-State 'answered' -1 # the opening note arrives as answer 0
}

function Get-Link {
    $frag = Get-AskuFragment ([Convert]::FromBase64String((Get-State 'pub'))) (ConvertFrom-AskuHex (Get-State 'T'))
    "$Base/a/$(Get-State 'sid')#$frag"
}

function Exit-Gone { Remove-Session; Fail 'session expired or closed' }

# Waits for the bind, sends the pending question, waits for its answer and prints it.
function Resume-Asku {
    if (-not (Test-Path (Join-Path $S 'sid'))) { Fail "no session; run: $PSCommandPath ask <file>" }
    $sid = Get-State 'sid'
    $deadline = (Get-Date).AddSeconds($WaitSec)
    while (-not (Test-Path (Join-Path $S 'peer'))) {
        if ((Get-Date) -ge $deadline) { Pending "The user has not opened the link yet. Give them: $(Get-Link)" }
        $r = Invoke-AskuRequest GET "/s/$sid/bind"
        if (-not $r) { Start-Sleep 2; continue }
        switch ($r.Code) {
            200 {
                $j = $r.Body | ConvertFrom-Json
                if (-not (Test-AskuBind (ConvertFrom-AskuHex (Get-State 'T')) ([Convert]::FromBase64String($j.pub)) ([Convert]::FromBase64String($j.mac)))) {
                    $null = Invoke-AskuRequest DELETE "/s/$sid"; Remove-Session
                    Fail 'the link was opened without the right token; session closed, start a new one'
                }
                Set-State 'peer' $j.pub
            }
            204 {}
            404 { Exit-Gone }
            default { Fail "bind poll failed ($($r.Code)): $($r.Body)" }
        }
    }
    $keys = Get-AskuKeys ([Convert]::FromBase64String((Get-State 'priv'))) ([Convert]::FromBase64String((Get-State 'peer')))
    $seq = [int](Get-State 'seq' 0)
    $pendingFile = Join-Path $S 'pending'
    if (Test-Path $pendingFile) {
        $seq++
        $envelope = Protect-AskuMessage $keys $sid 'q' $seq ([IO.File]::ReadAllBytes($pendingFile)) | ConvertTo-Json -Compress
        do { $r = Invoke-AskuRequest POST "/s/$sid/q" $envelope; if (-not $r) { Start-Sleep 2 } } until ($r)
        if ($r.Code -ne 204 -and $r.Code -ne 409) { Fail "send failed ($($r.Code)): $($r.Body)" } # 409: an earlier run already sent it
        Set-State 'seq' $seq
        Remove-Item $pendingFile
    }
    if ($seq -eq [int](Get-State 'answered' 0)) { Fail "no question pending; run: $PSCommandPath ask <file>" }
    while ($true) {
        if ((Get-Date) -ge $deadline) { Pending 'The user has not answered yet.' }
        $r = Invoke-AskuRequest GET "/s/$sid/a?after=$($seq - 1)"
        if (-not $r) { Start-Sleep 2; continue }
        switch ($r.Code) {
            200 {
                try { $pt = Unprotect-AskuMessage $keys $sid 'a' $seq @($r.Body | ConvertFrom-Json)[0] } catch { Fail 'answer failed verification' }
                [Console]::Out.Write([Text.Encoding]::UTF8.GetString($pt) + "`n")
                Set-State 'answered' $seq
                return
            }
            204 {}
            404 { Exit-Gone }
            default { Fail "answer poll failed ($($r.Code)): $($r.Body)" }
        }
    }
}

$usage = @"
usage: $PSCommandPath ask <questions.json>   send a question, print the answer JSON
       $PSCommandPath join <agent link>      join a session the user started, print their opening note
       $PSCommandPath wait                   keep waiting after PENDING
       $PSCommandPath close                  end the session
       $PSCommandPath version                print the client version
exit: 0 answered, 1 error, 2 PENDING (run wait)
env: ASKU_URL ASKU_SESSION ASKU_HOME ASKU_WAIT
"@

switch ($Command) {
    'ask' {
        if (-not $File -or -not (Test-Path $File)) { Fail 'ask needs a questions.json file' }
        if ((Test-Path (Join-Path $S 'pending')) -or (Get-State 'seq' 0) -ne (Get-State 'answered' 0)) { Fail "a question is still pending; run: $PSCommandPath wait" }
        $fresh = -not (Test-Path (Join-Path $S 'sid'))
        Start-AskuSession
        Copy-Item $File (Join-Path $S 'pending')
        if ($fresh) { Pending "Give the user this link: $(Get-Link)" }
        Resume-Asku
    }
    'join' { Join-AskuSession $File; Resume-Asku }
    'wait' { Resume-Asku }
    'version' { [Console]::Out.Write("$Version`n") }
    'close' {
        if (Test-Path (Join-Path $S 'sid')) { $null = Invoke-AskuRequest DELETE "/s/$(Get-State 'sid')" }
        Remove-Session
    }
    default { [Console]::Error.WriteLine($usage); exit 1 }
}
