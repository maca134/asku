# asku agent client. PowerShell 5.1 + .NET Framework only. Keep this file ASCII: PS 5.1 reads BOM-less files as ANSI.
$ErrorActionPreference = 'Stop'

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
