param([Parameter(Mandatory = $true)][int]$OwnedProcessId)
$ErrorActionPreference = 'Stop'
# This observer opens only the PID supplied by the owner of a disposable process.
# Retaining its handle prevents a later PID reuse from changing the observed target.
# No command lines, paths, thread stacks, handles or other processes are exported.
$ownedProcess = $null
function Send-Sample($value) {
    [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}
try {
    $ownedProcess = [Diagnostics.Process]::GetProcessById($OwnedProcessId)
    $null = $ownedProcess.Handle
    Send-Sample @{ type = 'ready' }
    if ([Console]::ReadLine() -ne 'start') { exit 1 }
    $sampleClock = [Diagnostics.Stopwatch]::StartNew()
    for ($sampleIndex = 0; $sampleIndex -lt 200; $sampleIndex++) {
        $ownedProcess.Refresh()
        if ($ownedProcess.HasExited) {
            Send-Sample @{ type = 'end'; reason = 'process-exited'; elapsedMs = $sampleClock.Elapsed.TotalMilliseconds }
            exit 0
        }
        $states = @{}
        $waits = @{}
        $unavailableThreads = 0
        $truncatedThreads = $false
        try {
            $cpuMs = $ownedProcess.TotalProcessorTime.TotalMilliseconds
            $threads = $ownedProcess.Threads
            $threadCount = $threads.Count
            $truncatedThreads = $threadCount -gt 512
            for ($threadIndex = 0; $threadIndex -lt [Math]::Min($threadCount, 512); $threadIndex++) {
                try {
                    $thread = $threads[$threadIndex]
                    $state = $thread.ThreadState.ToString()
                    $states[$state] = 1 + [int]$states[$state]
                    if ($state -eq 'Wait') {
                        try {
                            $reason = $thread.WaitReason.ToString()
                            $waits[$reason] = 1 + [int]$waits[$reason]
                        } catch { $unavailableThreads++ }
                    }
                } catch { $unavailableThreads++ }
            }
        } catch {
            if ($ownedProcess.HasExited) {
                Send-Sample @{ type = 'end'; reason = 'process-exited'; elapsedMs = $sampleClock.Elapsed.TotalMilliseconds }
                exit 0
            }
            Send-Sample @{ type = 'end'; reason = 'sample-unavailable'; elapsedMs = $sampleClock.Elapsed.TotalMilliseconds }
            exit 0
        }
        Send-Sample @{
            type = 'sample'; elapsedMs = $sampleClock.Elapsed.TotalMilliseconds
            cpuMs = $cpuMs; threadCount = $threadCount
            states = $states; waits = $waits
            unavailableThreads = $unavailableThreads; truncatedThreads = $truncatedThreads
        }
        if ($ownedProcess.WaitForExit(100)) {
            Send-Sample @{ type = 'end'; reason = 'process-exited'; elapsedMs = $sampleClock.Elapsed.TotalMilliseconds }
            exit 0
        }
        if ($sampleClock.Elapsed.TotalMilliseconds -ge 25000) { break }
    }
    Send-Sample @{ type = 'end'; reason = 'observation-limit'; elapsedMs = $sampleClock.Elapsed.TotalMilliseconds }
} catch {
    Send-Sample @{ type = 'error'; reason = 'observer-unavailable' }
    exit 1
} finally {
    if ($null -ne $ownedProcess) { $ownedProcess.Dispose() }
}
