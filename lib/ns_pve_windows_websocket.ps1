param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = 'Stop'
$stdout = [IO.StreamWriter]::new([Console]::OpenStandardOutput())
$stdout.AutoFlush = $true
function Emit([hashtable]$Value) { $stdout.WriteLine(($Value | ConvertTo-Json -Compress)) }

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
$cts = [System.Threading.CancellationTokenSource]::new()
$buffer = New-Object byte[] 65536
$stdin = [Console]::OpenStandardInput()
$inputBuffer = New-Object byte[] 4096
$inputPending = ''
$closing = $false
$closeCode = $null
$closeReason = ''

try {
    [void] $socket.ConnectAsync([Uri]$Url, $cts.Token).GetAwaiter().GetResult()
    Emit @{ type = 'open' }
    $receiveTask = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token)
    $inputTask = $stdin.BeginRead($inputBuffer, 0, $inputBuffer.Length, $null, $null)

    while (-not $closing -and $socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        if ($inputTask.IsCompleted) {
            $read = $stdin.EndRead($inputTask)
            if ($read -le 0) { break }
            $inputPending += [Text.Encoding]::UTF8.GetString($inputBuffer, 0, $read)
            while ($inputPending.Contains("`n")) {
                $pos = $inputPending.IndexOf("`n")
                $line = $inputPending.Substring(0, $pos).Trim()
                $inputPending = $inputPending.Substring($pos + 1)
                if ($line) {
                    $command = $line | ConvertFrom-Json
                    if ($command.type -eq 'close') { $closing = $true; break }
                    if ($command.type -eq 'send') {
                        $bytes = [Convert]::FromBase64String([string]$command.data)
                        [void] $socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
                    }
                }
            }
            if (-not $closing) { $inputTask = $stdin.BeginRead($inputBuffer, 0, $inputBuffer.Length, $null, $null) }
        }
        if ($receiveTask.IsCompleted) {
            $ms = [System.IO.MemoryStream]::new()
            try {
                do {
                    $result = $receiveTask.GetAwaiter().GetResult()
                    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                        if ($null -ne $result.CloseStatus) { $closeCode = [int]$result.CloseStatus }
                        if ($result.CloseStatusDescription) { $closeReason = [string]$result.CloseStatusDescription }
                        $closing = $true
                        break
                    }
                    if ($result.Count -gt 0) { $ms.Write($buffer, 0, $result.Count) }
                    if (-not $result.EndOfMessage) {
                        $receiveTask = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token)
                    }
                } while (-not $result.EndOfMessage)
                if (-not $closing) {
                    if ($ms.Length -gt 0) {
                        Emit @{ type = 'message'; data = [Convert]::ToBase64String($ms.ToArray()) }
                    }
                    $receiveTask = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cts.Token)
                }
            } finally {
                $ms.Dispose()
            }
        }
        Start-Sleep -Milliseconds 2
    }
    if ($null -eq $closeCode -and $socket.CloseStatus) { $closeCode = [int]$socket.CloseStatus }
    if (-not $closeReason -and $socket.CloseStatusDescription) { $closeReason = [string]$socket.CloseStatusDescription }
} catch {
    $closeCode = 1006
    $closeReason = $_.Exception.GetBaseException().Message
    Emit @{ type = 'error'; message = $closeReason }
} finally {
    try { $cts.Cancel() } catch {}
    try { $socket.Dispose() } catch {}
    $cts.Dispose()
    Emit @{ type = 'close'; code = $(if ($null -ne $closeCode) { $closeCode } else { 1000 }); reason = $closeReason }
}