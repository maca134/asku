# asku agent client. PowerShell 5.1 + .NET Framework only. Keep this file ASCII: PS 5.1 reads BOM-less files as ANSI.
param([string]$Command, [string]$File)
$ErrorActionPreference = 'Stop'
$Version = '1.5.0' # keep in step with ask.sh

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
$Self = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" # how messages tell the agent to run us again
if ($Command -ne 'close' -and (Test-Path (Join-Path $S 'sid')) -and -not (Test-Path (Join-Path $S 'priv'))) { # ask.sh keeps an OpenSSL key we can't read
    [Console]::Error.WriteLine("asku: session '$(Split-Path $S -Leaf)' belongs to ask.sh; use it, or set ASKU_SESSION"); exit 1
}

function Fail([string]$Msg) { [Console]::Error.WriteLine("asku: $Msg"); exit 1 }
$Stop = $false # once the user pressed STOP, every exit is 3
function Exit-Asku([int]$Code) { exit $(if ($script:Stop) { 3 } else { $Code }) }
function Pending([string]$Msg) { [Console]::Out.Write("PENDING`n$Msg`nRun again to keep waiting: $Self wait`n"); Exit-Asku 2 }
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
    if (Test-Path (Join-Path $S 'sid')) { Fail "session is in use; run: $Self close, or set ASKU_SESSION" }
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
    [IO.File]::WriteAllText((Join-Path $S 'o0.json'), '{"questions":[]}') # the opening note arrives as answer 0
}

function Get-Link {
    $frag = Get-AskuFragment ([Convert]::FromBase64String((Get-State 'pub'))) (ConvertFrom-AskuHex (Get-State 'T'))
    "$Base/a/$(Get-State 'sid')#$frag"
}

function Exit-Gone { Remove-Session; Fail "session expired or closed; run: $Self ask <file> to start a new one" }

# The open form is a list of batches: q<seq>.json are queued (not sent yet), o<seq>.json are sent and unanswered.
function Get-Batches([string]$Kind) {
    if (-not (Test-Path $S)) { return @() }
    @(Get-ChildItem $S -Filter "$Kind*.json" | ForEach-Object { [int]$_.BaseName.Substring(1) } | Sort-Object)
}
function Get-AskuIds([string]$Path) {
    try { $j = [IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { Fail "$Path is not valid JSON" }
    @($j.questions | ForEach-Object { $_.id })
}

function Get-AskuNextSeq { (@([int](Get-State 'seq' 0)) + @(Get-Batches 'q') | Measure-Object -Maximum).Maximum + 1 }
function Get-AskuNow { [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }

# Batches of the given kinds (q, o) whose deadline (d<seq>, unix seconds) has passed.
function Get-AskuExpired([string[]]$Kinds) {
    $now = Get-AskuNow
    @(foreach ($k in $Kinds) { foreach ($n in Get-Batches $k) { $d = Get-State "d$n"; if ($d -and [long]$d -le $now) { $n } } }) | Sort-Object
}

# The user ran out of time: drops those batches and prints a timeout answer for them.
function Exit-AskuTimeout([int[]]$Seqs) {
    $ids = @(foreach ($n in $Seqs) {
        foreach ($k in 'q', 'o') {
            $f = Join-Path $S "$k$n.json"
            if (Test-Path $f) { Get-AskuIds $f; Remove-Item $f }
        }
        Remove-Item -ErrorAction SilentlyContinue (Join-Path $S "d$n")
    })
    $skipped = ($ids | ForEach-Object { '"' + $_ + '"' }) -join ','
    [Console]::Out.Write('{"seqs":[' + ($Seqs -join ',') + '],"answers":{},"skipped":[' + $skipped + '],"comments":{},"note":"","timeout":true}' + "`n")
    $left = (Get-Batches 'o').Count
    if ($left) { [Console]::Error.WriteLine("asku: $left batch(es) still pending; run: $Self wait") }
    Exit-Asku 0
}
function Test-AskuExpired([string[]]$Kinds) { $x = @(Get-AskuExpired $Kinds); if ($x.Count) { Exit-AskuTimeout $x } }

# Queues a batch onto the open form, starting a session (and printing its link) if there is none.
# The 50-question limit and unique ids span the whole form.
function Add-AskuBatch([string]$File) {
    $fresh = -not (Test-Path (Join-Path $S 'sid'))
    if (-not $File -or -not (Test-Path $File)) { Fail "$Command needs a questions.json file" }
    $new = Get-AskuIds $File
    # ponytail: counts batches the user may have just submitted (we can't know yet); a false refusal only costs a rename
    $open = @(foreach ($k in 'q', 'o') { foreach ($n in Get-Batches $k) { Get-AskuIds (Join-Path $S "$k$n.json") } })
    $dup = @($new | Where-Object { $open -contains $_ })
    if ($dup.Count) { Fail "ids already in the open form: $($dup -join ', ')" }
    if ($open.Count + $new.Count -gt 50) { Fail "the open form would have $($open.Count + $new.Count) questions, the limit is 50" }
    Start-AskuSession
    $seq = Get-AskuNextSeq
    # a deadline counts from now: remember when it ends, and tell the page when the batch was asked
    $text = [IO.File]::ReadAllText($File)
    $deadline = ($text | ConvertFrom-Json).deadline
    if ($deadline) {
        $now = Get-AskuNow
        Set-State "d$seq" ($now + [long]$deadline)
        $text = '{"sent":' + $now + ',' + $text.Substring($text.IndexOf('{') + 1)
    }
    [IO.File]::WriteAllText((Join-Path $S "q$seq.json"), $text)
    if ($fresh) { Pending "Give the user this link: $(Get-Link)" }
}

# A one-way update for the page's feed, or with --progress <done>/<total> a progress bar labelled by the text.
# Queued until the user opens the link; never answered.
function Add-AskuSay([string[]]$Words) {
    if (-not (Test-Path (Join-Path $S 'sid'))) { Fail 'no session; say only works while a form is open or after join' }
    $text = @(); $progress = $null
    for ($i = 0; $i -lt $Words.Count; $i++) {
        if ($Words[$i] -ne '--progress') { $text += $Words[$i]; continue }
        $i++
        if (-not ($Words[$i] -match '^(\d+)/(\d+)$') -or [long]$Matches[1] -gt [long]$Matches[2] -or [long]$Matches[2] -lt 1) {
            Fail '--progress needs <done>/<total>, 0 <= done <= total, total >= 1'
        }
        $progress = [ordered]@{ done = [long]$Matches[1]; total = [long]$Matches[2] }
    }
    $text = ($text | Where-Object { $_ }) -join ' '
    if (-not $text) { Fail 'say needs some text' }
    $message = [ordered]@{ say = $text }
    if ($progress) { $message.progress = $progress }
    [IO.File]::WriteAllText((Join-Path $S "q$(Get-AskuNextSeq).json"), ($message | ConvertTo-Json -Compress))
}

# Waits for the bind (or checks it once with -NoWait), then sends the queued batches. Returns the keys, or $null if not bound yet.
function Send-Asku([switch]$NoWait) {
    if (-not (Test-Path (Join-Path $S 'sid'))) { Fail "no session; run: $Self ask <file>" }
    $sid = Get-State 'sid'
    $deadline = (Get-Date).AddSeconds($WaitSec)
    if ($NoWait -and -not (Test-Path (Join-Path $S 'peer'))) {
        $r = Invoke-AskuRequest GET "/s/$sid" # GET bind would hold for the long-poll
        if ($r -and $r.Code -eq 404) { Exit-Gone }
        if (-not $r -or $r.Code -ne 200 -or -not ($r.Body | ConvertFrom-Json).bound) { return $null }
    }
    while (-not (Test-Path (Join-Path $S 'peer'))) {
        Test-AskuExpired 'q'
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
    # Queue numbers can have gaps (a batch that timed out before it was sent); the relay needs seqs without any.
    foreach ($n in Get-Batches 'q') {
        $f = Join-Path $S "q$n.json"
        $seq = [int](Get-State 'seq' 0) + 1
        $envelope = Protect-AskuMessage $keys $sid 'q' $seq ([IO.File]::ReadAllBytes($f)) | ConvertTo-Json -Compress
        do {
            $r = Invoke-AskuRequest POST "/s/$sid/q" $envelope
            if (-not $r) { if ((Get-Date) -ge $deadline) { Pending "Could not reach the relay at $Base; questions are still queued." }; Start-Sleep 2 }
        } until ($r)
        if ($r.Code -ne 204 -and -not ($r.Code -eq 409 -and $r.Body -match 'duplicate')) { Fail "send failed ($($r.Code)): $($r.Body)" } # duplicate: an earlier run sent it
        Set-State 'seq' $seq
        if ([IO.File]::ReadAllText($f).StartsWith('{"say":')) { Remove-Item $f; continue }
        Move-Item -Force $f (Join-Path $S "o$seq.json")
        $d = Join-Path $S "d$n"
        if (Test-Path $d) { Move-Item -Force $d (Join-Path $S "d$seq") }
    }
    @{ Keys = $keys; Sid = $sid; Deadline = $deadline }
}

# Prints the user's messages (dir m) among the envelopes, in order, each once. Returns how many; sets Stop on a stop.
function Show-AskuMessages($Keys, [string]$Sid, $Envelopes) {
    $shown = 0
    foreach ($e in @($Envelopes | Where-Object { $_.dir -eq 'm' })) {
        $seq = [int](Get-State 'm' 0) + 1
        try { $text = [Text.Encoding]::UTF8.GetString((Unprotect-AskuMessage $Keys $Sid 'm' $seq $e)) } catch { Fail 'a message failed verification' }
        [Console]::Out.Write($text + "`n")
        Set-State 'm' $seq
        if ($text.StartsWith('{"stop":true')) { $script:Stop = $true }
        $shown++
    }
    $shown
}

# Prints messages that came in since the last call, without waiting for any.
function Show-AskuInbox($c) {
    $r = Invoke-AskuRequest GET "/s/$($c.Sid)/m?after=$(Get-State 'm' 0)"
    if ($r -and $r.Code -eq 200) { $null = Show-AskuMessages $c.Keys $c.Sid @($r.Body | ConvertFrom-Json | ForEach-Object { $_ }) }
}

# Waits for the next answer to an open batch and prints it. One answer can cover several batches (its seqs).
function Wait-Asku {
    Test-AskuExpired 'q'
    $c = Send-Asku
    if (-not (Get-Batches 'o').Count) { Fail "no question pending; run: $Self ask <file>" }
    # From the oldest open batch, not a cursor: an error for batch 3 can land before the answer to batch 2.
    $after = @(Get-Batches 'o')[0] - 1
    while ($true) {
        if ((Get-Date) -ge $c.Deadline) { Pending "The user has not answered yet.$(if (Get-State 'T') { " If they lost the page, their link is: $(Get-Link)" })" }
        $r = Invoke-AskuRequest GET "/s/$($c.Sid)/a?after=$after&m=$(Get-State 'm' 0)"
        if (-not $r) { Start-Sleep 2; continue }
        switch ($r.Code) {
            200 {
                $all = @($r.Body | ConvertFrom-Json | ForEach-Object { $_ }) # PS 5.1 emits a JSON array as one object
                $shown = Show-AskuMessages $c.Keys $c.Sid $all
                $env = $all | Where-Object { $_.dir -eq 'a' -and (Test-Path (Join-Path $S "o$($_.seq).json")) } | Select-Object -First 1
                if (-not $env -and $shown) { Pending 'The user has not answered yet.' }
                if (-not $env) { Test-AskuExpired 'o'; Start-Sleep 2; break } # all already handled; keep the cursor, a lower seq can still arrive
                $seq = [int]$env.seq
                try { $text = [Text.Encoding]::UTF8.GetString((Unprotect-AskuMessage $c.Keys $c.Sid 'a' $seq $env)) } catch { Fail 'answer failed verification' }
                # seqs (inside the encrypted answer) names the batches it covers; older pages: an error covers its own, an answer all up to it
                $j = $(try { $text | ConvertFrom-Json } catch { $null })
                $covered = if ($j -and $j.seqs) { @($j.seqs) } elseif ($j -and $j.error) { @($seq) } else { @(Get-Batches 'o') }
                foreach ($n in $covered) { if ([int]$n -le $seq) { Remove-Item -ErrorAction SilentlyContinue (Join-Path $S "o$([int]$n).json") } }
                [Console]::Out.Write($text + "`n")
                $left = (Get-Batches 'o').Count
                if ($left) { [Console]::Error.WriteLine("asku: $left batch(es) still pending; run: $Self wait") }
                Exit-Asku 0
            }
            204 { Test-AskuExpired 'o' } # checked after a poll, so an answer that beat the deadline wins
            404 { Exit-Gone }
            default { Fail "answer poll failed ($($r.Code)): $($r.Body)" }
        }
    }
}

$usage = @"
usage: $Self ask <questions.json>   send a question, print the answer JSON
       $Self add <questions.json>   append questions to the open form without waiting
       $Self join <agent link>      join a session the user started, print their opening note
       $Self say "<text>"           show a one-way update on the user's page
         [--progress <done>/<total>]  as a progress bar labelled <text>; same label, same bar
       $Self wait                   keep waiting after PENDING
       $Self close                  end the session
       $Self version                print the client version
the user's messages print first, one JSON line each: {"message":"..."} or {"stop":true}
exit: 0 answered, 1 error, 2 PENDING (run wait), 3 the user pressed STOP
env: ASKU_URL ASKU_SESSION ASKU_HOME ASKU_WAIT
"@

switch ($Command) {
    'ask' {
        if ((Get-Batches 'q').Count + (Get-Batches 'o').Count) { Fail "a form is open; run: $Self add <file> to append, or $Self wait" }
        Add-AskuBatch $File
        Wait-Asku
    }
    'add' {
        Add-AskuBatch $File
        $c = Send-Asku -NoWait
        if (-not $c) { Pending "Queued. The user has not opened the link yet. Give them: $(Get-Link)" }
        Show-AskuInbox $c
        Pending 'Sent. Add more with add, or run wait for the answer.'
    }
    'join' { Join-AskuSession $File; Wait-Asku }
    'say' {
        Add-AskuSay (@($File) + $args)
        $c = Send-Asku -NoWait
        if (-not $c) { [Console]::Out.Write("Queued: it shows once the user opens the link.`n"); exit 0 }
        Show-AskuInbox $c
        [Console]::Out.Write("Said.`n")
        Exit-Asku 0
    }
    'wait' { Wait-Asku }
    'version' { [Console]::Out.Write("$Version`n") }
    'close' {
        if (Test-Path (Join-Path $S 'sid')) { $null = Invoke-AskuRequest DELETE "/s/$(Get-State 'sid')" }
        Remove-Session
    }
    default { [Console]::Error.WriteLine($usage); exit 1 }
}
