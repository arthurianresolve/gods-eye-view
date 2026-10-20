import {
  execFileSync as defaultExecFileSync,
  spawn as defaultSpawn,
} from 'node:child_process';
import { performance } from 'node:perf_hooks';

const TARGET_TYPES = Object.freeze([
  'background_page',
  'browser',
  'page',
  'service_worker',
  'shared_worker',
  'webview',
  'worker',
  'other',
]);
const PROCESS_ROLES = new Set([
  'browser',
  'renderer',
  'gpu',
  'utility',
  'crashpad',
  'other',
  'unavailable',
]);
const MAX_PROCESS_TREE_ROWS = 64;
const MAX_PROCESS_TREE_OUTPUT_BYTES = 12_000;
const PROCESS_TREE_TIMEOUT_MS = 1_500;
const MAX_CDP_PROCESS_ROWS = 64;
const MAX_CDP_PROCESS_INFO_ROWS = 512;
const SYSTEM_INFO_PROCESS_TIMEOUT_MS = 1_000;
const SYSTEM_INFO_SESSION_TIMEOUT_MS = 800;

function unavailableSnapshot(reason) {
  return { status: 'unavailable', reason };
}

function classifyProcessInfoError(error) {
  const code = error?.code;
  const message = typeof error?.message === 'string' ? error.message : '';
  const originalMessage =
    typeof error?.originalMessage === 'string' ? error.originalMessage : '';
  if (
    code === -32601 ||
    code === 'METHOD_NOT_FOUND' ||
    originalMessage.startsWith("'SystemInfo.getProcessInfo' wasn't found")
  )
    return 'process-info-unsupported';
  if (
    code === 'ETIMEDOUT' ||
    message.includes('SystemInfo.getProcessInfo timed out.')
  )
    return 'process-info-timeout';
  if (code === 'EPERM') return 'process-info-permission-denied';
  if (
    code === 'ESRCH' ||
    error?.name === 'ConnectionClosedError' ||
    error?.name === 'TargetCloseError'
  )
    return 'process-info-connection-lost';
  if (code === 'GEV_CDP_CONNECTION_UNAVAILABLE')
    return 'process-info-connection-unavailable';
  if (code === 'GEV_CDP_LIMITS_INVALID')
    return 'process-info-timeout-limit-invalid';
  return 'process-info-query-failed';
}

function processRole(type) {
  const normalized = type.toLowerCase();
  if (normalized === 'browser') return 'browser';
  if (normalized === 'renderer') return 'renderer';
  if (normalized === 'gpu' || normalized === 'gpu-process') return 'gpu';
  if (normalized === 'utility') return 'utility';
  if (normalized.includes('crashpad')) return 'crashpad';
  return 'other';
}

/** Keep only bounded process roles and IDs returned by the owned browser CDP target. */
export function summarizeBrowserProcessInfo(
  response,
  maxRows = MAX_CDP_PROCESS_ROWS,
) {
  if (
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > MAX_CDP_PROCESS_ROWS
  )
    return unavailableSnapshot('process-info-limit-invalid');
  const processInfo = response?.processInfo;
  if (!Array.isArray(processInfo))
    return unavailableSnapshot('process-info-list-invalid');
  if (processInfo.length > MAX_CDP_PROCESS_INFO_ROWS)
    return unavailableSnapshot('process-info-overflow');
  const seen = new Set();
  const rows = [];
  for (const item of processInfo) {
    if (
      !Number.isSafeInteger(item?.id) ||
      item.id < 1 ||
      typeof item.type !== 'string' ||
      item.type.length < 1 ||
      item.type.length > 80 ||
      seen.has(item.id)
    )
      return unavailableSnapshot('process-info-list-invalid');
    seen.add(item.id);
    rows.push({ id: item.id, role: processRole(item.type) });
  }
  rows.sort((left, right) => left.id - right.id);
  return {
    status: 'available',
    source: 'SystemInfo.getProcessInfo',
    processCount: rows.length,
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows,
    retainedFields: ['id', 'role'],
  };
}

/** Read SystemInfo on Puppeteer's already-owned browser connection. */
export async function readRecoveryBrowserProcessInfo(
  browser,
  { timeoutMs = SYSTEM_INFO_SESSION_TIMEOUT_MS } = {},
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > SYSTEM_INFO_SESSION_TIMEOUT_MS
  ) {
    const error = new Error('Browser process inventory limits are invalid.');
    error.code = 'GEV_CDP_LIMITS_INVALID';
    throw error;
  }
  const connection = browser?._connection;
  if (typeof connection?.send !== 'function') {
    const error = new Error('Owned browser CDP connection is unavailable.');
    error.code = 'GEV_CDP_CONNECTION_UNAVAILABLE';
    throw error;
  }
  // Puppeteer 25.10.0's Connection.send accepts a per-command timeout and
  // retires the callback when it expires. This avoids creating a target
  // session whose attach/detach could outlive the shutdown observation.
  return connection.send(
    'SystemInfo.getProcessInfo',
    {},
    { timeout: timeoutMs },
  );
}

/** Observe only the owned browser PID; PID presence does not prove identity. */
export function observeOwnedBrowserPidPresence(
  child,
  { platform = process.platform, killProcess = process.kill } = {},
) {
  if (platform !== 'win32') return unavailableSnapshot('unsupported-platform');
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid < 1)
    return unavailableSnapshot('owned-browser-pid-unavailable');
  if (child.exitCode != null || child.signalCode != null)
    return { status: 'exited', pid, source: 'child-exit-observed' };
  try {
    killProcess(pid, 0);
    return {
      status: 'present',
      pid,
      source: 'owned-pid-presence-only',
      identityConfirmed: false,
      pidReusePossible: true,
    };
  } catch (error) {
    if (error?.code === 'ESRCH')
      return { status: 'absent', pid, source: 'owned-pid-presence-only' };
    return unavailableSnapshot(
      error?.code === 'EPERM'
        ? 'owned-pid-presence-permission-denied'
        : 'owned-pid-presence-check-failed',
    );
  }
}

async function captureBrowserProcessInfo(snapshot, timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > SYSTEM_INFO_PROCESS_TIMEOUT_MS
  )
    return unavailableSnapshot('process-info-timeout-limit-invalid');
  if (typeof snapshot !== 'function')
    return unavailableSnapshot('process-info-probe-not-configured');
  let timer;
  const pending = Promise.resolve()
    .then(snapshot)
    .then(
      (value) => ({ kind: 'resolved', value }),
      (error) => ({ kind: 'rejected', error }),
    );
  let result;
  try {
    result = await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (result.kind === 'timeout')
    return unavailableSnapshot('process-info-timeout');
  if (result.kind === 'rejected')
    return unavailableSnapshot(classifyProcessInfoError(result.error));
  return summarizeBrowserProcessInfo(result.value);
}

function targetTypeSnapshot(browser) {
  if (browser?.isConnected?.() === false)
    return unavailableSnapshot('browser-disconnected');
  let targets;
  try {
    targets = browser?.targets?.();
  } catch {
    return unavailableSnapshot('target-query-failed');
  }
  if (!Array.isArray(targets))
    return unavailableSnapshot('target-list-unavailable');
  const counts = Object.fromEntries(TARGET_TYPES.map((type) => [type, 0]));
  let malformedTargetCount = 0;
  for (const target of targets) {
    let type;
    try {
      type = target?.type?.();
    } catch {
      malformedTargetCount += 1;
      counts.other += 1;
      continue;
    }
    if (typeof type !== 'string') {
      malformedTargetCount += 1;
      counts.other += 1;
      continue;
    }
    counts[Object.hasOwn(counts, type) ? type : 'other'] += 1;
  }
  return {
    status: 'available',
    source: 'browser.targets',
    targetCount: targets.length,
    counts,
    malformedTargetCount,
  };
}

/** Validate and reduce a process listing to the owned Chrome process tree only. */
export function summarizeOwnedProcessTree(
  rawRows,
  rootPid,
  maxRows = MAX_PROCESS_TREE_ROWS,
) {
  if (!Number.isSafeInteger(rootPid) || rootPid < 1)
    return unavailableSnapshot('owned-browser-pid-unavailable');
  if (!Array.isArray(rawRows))
    return unavailableSnapshot('process-list-invalid');
  if (
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > MAX_PROCESS_TREE_ROWS
  )
    return unavailableSnapshot('process-limit-invalid');

  const rows = [];
  const byPid = new Map();
  for (const item of rawRows) {
    const pid = Number(item?.pid ?? item?.ProcessId);
    const ppid = Number(item?.ppid ?? item?.ParentProcessId);
    const rawImage = item?.image ?? item?.Name;
    const category = item?.category;
    if (
      !Number.isSafeInteger(pid) ||
      pid < 1 ||
      !Number.isSafeInteger(ppid) ||
      ppid < 0 ||
      typeof rawImage !== 'string' ||
      !rawImage ||
      /[\\/]/.test(rawImage) ||
      rawImage.length > 80 ||
      !/^[A-Za-z0-9_.-]+$/.test(rawImage) ||
      (category !== undefined && !PROCESS_ROLES.has(category)) ||
      byPid.has(pid)
    )
      return unavailableSnapshot('process-list-invalid');
    const row = {
      pid,
      ppid,
      image: rawImage,
      category: category || 'unavailable',
    };
    byPid.set(pid, row);
    rows.push(row);
  }
  if (!byPid.has(rootPid))
    return unavailableSnapshot('owned-browser-not-in-process-list');

  const included = new Set([rootPid]);
  const owned = [byPid.get(rootPid)];
  const queue = [rootPid];
  while (queue.length && owned.length < maxRows) {
    const parentPid = queue.shift();
    for (const row of rows) {
      if (row.ppid !== parentPid || included.has(row.pid)) continue;
      included.add(row.pid);
      owned.push(row);
      queue.push(row.pid);
      if (owned.length >= maxRows) break;
    }
  }
  const truncated = rows.some(
    (row) => !included.has(row.pid) && included.has(row.ppid),
  );
  return {
    status: 'available',
    rootPid,
    rows: owned,
    processCount: owned.length,
    truncated,
  };
}

export function createOwnedProcessTreePowerShellCommand(rootPid, maxRows) {
  return (
    `$rootPid = ${rootPid}\n` +
    `$limit = ${maxRows}\n` +
    '$all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,Name)\n' +
    '$root = $all | Where-Object { [int]$_.ProcessId -eq $rootPid } | Select-Object -First 1\n' +
    '$result = @()\n' +
    '$seen = @{}\n' +
    'if ($null -ne $root) {\n' +
    '  $result += [pscustomobject]@{ pid=[int]$root.ProcessId; ppid=[int]$root.ParentProcessId; image=[string]$root.Name }\n' +
    '  $seen[[string]$rootPid] = $true; $frontier = @($rootPid)\n' +
    '  while ($frontier.Count -gt 0) {\n' +
    '    $next = @()\n' +
    '    foreach ($process in $all) {\n' +
    '      $childPid = [int]$process.ProcessId; $parentPid = [int]$process.ParentProcessId\n' +
    '      if (($frontier -contains $parentPid) -and (-not $seen.ContainsKey([string]$childPid))) {\n' +
    '        if ($result.Count -ge $limit) { $truncated = $true; continue }\n' +
    '        $seen[[string]$childPid] = $true\n' +
    '        $result += [pscustomobject]@{ pid=$childPid; ppid=$parentPid; image=[string]$process.Name }\n' +
    '        $next += $childPid\n' +
    '      }\n' +
    '    }\n' +
    '    $frontier = $next\n' +
    '  }\n' +
    '}\n' +
    '$truncated = @($all | Where-Object { (-not $seen.ContainsKey([string]$_.ProcessId)) -and $seen.ContainsKey([string]$_.ParentProcessId) }).Count -gt 0\n' +
    'if ($result.Count -gt 0) {\n' +
    '  $roleByPid = @{}\n' +
    '  $commandFilter = (@($result | ForEach-Object { "ProcessId = $($_.pid)" }) -join " OR ")\n' +
    '  $rolesAvailable = $true\n' +
    '  try {\n' +
    '    $ownedCommands = @(Get-CimInstance Win32_Process -Filter $commandFilter -Property ProcessId,CommandLine -ErrorAction Stop)\n' +
    '    foreach ($ownedCommand in $ownedCommands) {\n' +
    '      $commandLine = [string]$ownedCommand.CommandLine\n' +
    '      $typeMatch = [regex]::Match($commandLine, "(?:^|\\s)--type=([A-Za-z0-9_-]+)(?:\\s|$)")\n' +
    '      if ([string]::IsNullOrWhiteSpace($commandLine)) { $roleByPid[[string]$ownedCommand.ProcessId] = "unavailable"; continue }\n' +
    '      $role = "other"\n' +
    '      if ([int]$ownedCommand.ProcessId -eq $rootPid -and -not $typeMatch.Success -and ($result | Where-Object { [int]$_.pid -eq $rootPid -and $_.image -match "^chrome(?:\\.exe)?$" })) { $role = "browser" }\n' +
    '      elseif ($result | Where-Object { [int]$_.pid -eq [int]$ownedCommand.ProcessId -and $_.image -match "^chrome_crashpad_handler(?:\\.exe)?$" }) { $role = "crashpad" }\n' +
    '      elseif ($typeMatch.Success) {\n' +
    '        switch ($typeMatch.Groups[1].Value) {\n' +
    '          "renderer" { $role = "renderer" }\n' +
    '          "gpu-process" { $role = "gpu" }\n' +
    '          "utility" { $role = "utility" }\n' +
    '          "crashpad-handler" { $role = "crashpad" }\n' +
    '          default { $role = "other" }\n' +
    '        }\n' +
    '      }\n' +
    '      $roleByPid[[string]$ownedCommand.ProcessId] = $role\n' +
    '    }\n' +
    '  } catch { $rolesAvailable = $false }\n' +
    '  foreach ($row in $result) {\n' +
    '    if ($rolesAvailable -and $roleByPid.ContainsKey([string]$row.pid)) { $row | Add-Member -NotePropertyName category -NotePropertyValue $roleByPid[[string]$row.pid] }\n' +
    '    else { $row | Add-Member -NotePropertyName category -NotePropertyValue "unavailable" }\n' +
    '  }\n' +
    '}\n' +
    '[pscustomobject]@{ rows=@($result); truncated=$truncated } | ConvertTo-Json -Compress -Depth 3'
  );
}

/** Bounded Windows snapshot; arguments are queried only for owned PIDs and never retained or emitted. */
export function captureOwnedBrowserProcessTree(
  child,
  {
    platform = process.platform,
    execFile = defaultExecFileSync,
    timeoutMs = PROCESS_TREE_TIMEOUT_MS,
    maxRows = MAX_PROCESS_TREE_ROWS,
  } = {},
) {
  if (platform !== 'win32') return unavailableSnapshot('unsupported-platform');
  const rootPid = child?.pid;
  if (!Number.isSafeInteger(rootPid) || rootPid < 1)
    return unavailableSnapshot('owned-browser-pid-unavailable');
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > PROCESS_TREE_TIMEOUT_MS ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > MAX_PROCESS_TREE_ROWS
  )
    return unavailableSnapshot('process-snapshot-limits-invalid');
  try {
    const output = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        createOwnedProcessTreePowerShellCommand(rootPid, maxRows),
      ],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_PROCESS_TREE_OUTPUT_BYTES,
        windowsHide: true,
      },
    );
    if (
      typeof output !== 'string' ||
      Buffer.byteLength(output, 'utf8') > MAX_PROCESS_TREE_OUTPUT_BYTES
    )
      return unavailableSnapshot('process-list-overflow');
    const parsed = JSON.parse(output);
    if (typeof parsed?.truncated !== 'boolean')
      return unavailableSnapshot('process-list-invalid');
    const summarized = summarizeOwnedProcessTree(
      parsed?.rows,
      rootPid,
      maxRows,
    );
    if (summarized.status !== 'available') return summarized;
    return {
      ...summarized,
      truncated: parsed.truncated === true || summarized.truncated,
    };
  } catch (error) {
    return unavailableSnapshot(
      error?.code === 'ETIMEDOUT'
        ? 'process-snapshot-timeout'
        : error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ? 'process-list-overflow'
          : 'process-snapshot-failed',
    );
  }
}

function applicationPages(pages, baseUrl) {
  const appOrigin = new URL(baseUrl).origin;
  return pages.filter((page) => {
    try {
      return new URL(page.url()).origin === appOrigin;
    } catch {
      return false;
    }
  });
}

export function countRecoveryApplicationPages(pages, baseUrl) {
  return applicationPages(pages, baseUrl).length;
}

export function createRecoveryPageTargetGuard(browser) {
  const createdPageTargets = new Set();
  const onTargetCreated = (target) => {
    if (target.type() === 'page') createdPageTargets.add(target);
  };
  browser.on('targetcreated', onTargetCreated);
  return {
    unexpectedPageTargetCount(page) {
      const ownedTarget = page?.target?.();
      return [...createdPageTargets].filter((target) => target !== ownedTarget)
        .length;
    },
    assertOnlyOwnedPageTarget(page) {
      const unexpected = this.unexpectedPageTargetCount(page);
      if (unexpected)
        throw new Error(
          `Unexpected page targets were created during this recovery stage (${unexpected}).`,
        );
      return createdPageTargets.size;
    },
    dispose() {
      browser.off('targetcreated', onTargetCreated);
    },
  };
}

export function assertInitialRecoveryPage(pages, baseUrl) {
  const applicationCount = countRecoveryApplicationPages(pages, baseUrl);
  if (
    pages.length !== 1 ||
    pages[0].url() !== 'about:blank' ||
    applicationCount !== 0
  )
    throw new Error(
      `Expected exactly one initial about:blank page and no restored app pages; found ${pages.length} pages (${applicationCount} app pages).`,
    );
  return pages[0];
}

export function assertOwnedRecoveryPage(pages, ownedPage, baseUrl) {
  const ownedUrl = ownedPage?.url?.() || '';
  const application = applicationPages(pages, baseUrl);
  if (
    pages.length !== 1 ||
    application.length !== 1 ||
    application[0] !== ownedPage ||
    new URL(ownedUrl).origin !== new URL(baseUrl).origin
  )
    throw new Error(
      `Expected exactly one app page owned by this recovery stage; found ${pages.length} pages (${application.length} app pages).`,
    );
  return application.length;
}

function boundedFailureName(error) {
  const name = error?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name)
    ? name.slice(0, 48)
    : 'Error';
}

async function observeCloseStage(
  operation,
  timeoutMs,
  { now, setTimer, clearTimer },
) {
  const startedAt = now();
  let deadlineReached = false;
  let timer;
  const lateSettlement = { status: 'not-applicable' };
  const pending = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ status: 'completed', value }),
      (error) => ({ status: 'rejected', errorName: boundedFailureName(error) }),
    );
  pending.then((result) => {
    if (deadlineReached) lateSettlement.status = result.status;
  });
  const result = await Promise.race([
    pending,
    new Promise((resolve) => {
      timer = setTimer(() => {
        deadlineReached = true;
        lateSettlement.status = 'pending';
        resolve({ status: 'timed-out' });
      }, timeoutMs);
    }),
  ]);
  clearTimer(timer);
  const elapsedMs = Math.max(0, now() - startedAt);
  return {
    status: result.status,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
    errorName: result.errorName ?? null,
    value: result.value,
    lateSettlement,
  };
}

/** Close the owned page before the browser, retaining bounded stage outcomes. */
export async function closeOwnedRecoveryPage(
  page,
  browser,
  timeoutMs = 2000,
  {
    now = () => performance.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  const stageOptions = { now, setTimer, clearTimer };
  if (!page)
    return {
      closeCompleted: false,
      openPageCount: null,
      closeObservation: {
        status: 'not-attempted',
        elapsedMs: 0,
        errorName: null,
        lateSettlement: { status: 'not-applicable' },
        pageInventory: {
          status: 'not-attempted',
          elapsedMs: 0,
          errorName: null,
        },
      },
    };

  const closeStage = await observeCloseStage(
    async () => {
      if (page.isClosed()) return 'already-closed';
      await page.close({ runBeforeUnload: false });
      return 'closed';
    },
    timeoutMs,
    stageOptions,
  );
  const closeStatus =
    closeStage.status === 'completed' && closeStage.value === 'already-closed'
      ? 'already-closed'
      : closeStage.status;
  const closeCompleted = closeStage.status === 'completed';
  let pageInventory = {
    status: 'not-requested-after-close-failure',
    elapsedMs: 0,
    errorName: null,
  };
  let openPageCount = null;
  if (closeCompleted) {
    const inventoryStage = await observeCloseStage(
      () => browser.pages(),
      timeoutMs,
      stageOptions,
    );
    pageInventory = {
      status: inventoryStage.status,
      elapsedMs: inventoryStage.elapsedMs,
      errorName: inventoryStage.errorName,
    };
    if (
      inventoryStage.status === 'completed' &&
      Array.isArray(inventoryStage.value)
    )
      openPageCount = inventoryStage.value.length;
    else if (inventoryStage.status === 'completed')
      pageInventory.status = 'malformed';
  }
  return {
    closeCompleted,
    openPageCount,
    closeObservation: {
      status: closeStatus,
      elapsedMs: closeStage.elapsedMs,
      errorName: closeStage.errorName,
      lateSettlement: closeStage.lateSettlement,
      pageInventory,
    },
  };
}

const CDP_SEND_PREFIX = 'puppeteer:protocol:SEND';
const CDP_RECEIVE_PREFIX = 'puppeteer:protocol:RECV';
const MAX_CLOSE_PROTOCOL_MESSAGES = 64;
const MAX_CLOSE_PROTOCOL_MESSAGE_LENGTH = 32_768;

/** Keep only bounded Browser.close protocol milestones while close is active. */
export function createRecoveryBrowserCloseTrace({
  now = () => performance.now(),
} = {}) {
  let active = false;
  let startedAt = null;
  let messageCount = 0;
  let overflow = false;
  let malformedCloseMessage = false;
  let browserCloseRequestId = null;
  let requestElapsedMs = null;
  let acknowledgementElapsedMs = null;
  let acknowledgementError = null;
  let disconnectedElapsedMs = null;
  let finished = false;

  const summarize = (deadlineMs = null) => ({
    scope: 'owned-browser-close-only',
    browserCloseRequestSeen: requestElapsedMs !== null,
    browserCloseRequestElapsedMs: requestElapsedMs,
    browserCloseAcknowledgementSeen: acknowledgementElapsedMs !== null,
    browserCloseAcknowledgementElapsedMs: acknowledgementElapsedMs,
    browserCloseAcknowledgementLate:
      acknowledgementElapsedMs !== null &&
      Number.isFinite(deadlineMs) &&
      acknowledgementElapsedMs > deadlineMs,
    browserCloseAcknowledgementError: acknowledgementError,
    browserDisconnected: disconnectedElapsedMs !== null,
    browserDisconnectedElapsedMs: disconnectedElapsedMs,
    malformedCloseMessage,
    protocolMessageCount: messageCount,
    protocolMessageOverflow: overflow,
    protocolObservationComplete: !overflow,
  });

  const elapsed = () => Math.max(0, now() - startedAt);
  const logProtocol = (direction, args) => {
    if (!active) return;
    if (messageCount >= MAX_CLOSE_PROTOCOL_MESSAGES) {
      overflow = true;
      return;
    }
    messageCount += 1;
    const raw = args[0];
    if (
      typeof raw !== 'string' ||
      raw.length > MAX_CLOSE_PROTOCOL_MESSAGE_LENGTH
    ) {
      overflow = true;
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      if (raw.includes('Browser.close')) malformedCloseMessage = true;
      return;
    }
    if (direction === 'send' && message?.method === 'Browser.close') {
      if (
        !Number.isSafeInteger(message.id) ||
        message.id < 0 ||
        message.sessionId !== undefined
      ) {
        malformedCloseMessage = true;
        return;
      }
      browserCloseRequestId = message.id;
      requestElapsedMs ??= elapsed();
      return;
    }
    if (
      direction === 'receive' &&
      browserCloseRequestId !== null &&
      message?.sessionId === undefined &&
      message?.method === undefined &&
      Number.isSafeInteger(message?.id) &&
      message.id >= 0 &&
      message?.id === browserCloseRequestId &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
    ) {
      acknowledgementElapsedMs ??= elapsed();
      acknowledgementError ??= Object.hasOwn(message, 'error');
    }
  };

  return {
    logger(prefix) {
      if (typeof prefix !== 'string') return undefined;
      if (prefix.startsWith(CDP_SEND_PREFIX))
        return (...args) => logProtocol('send', args);
      if (prefix.startsWith(CDP_RECEIVE_PREFIX))
        return (...args) => logProtocol('receive', args);
      return undefined;
    },
    begin() {
      if (active || finished) throw new Error('Close trace is not reusable.');
      startedAt = now();
      active = true;
    },
    recordDisconnected() {
      if (active) disconnectedElapsedMs ??= elapsed();
    },
    snapshot(deadlineMs = null) {
      return active && !finished ? summarize(deadlineMs) : null;
    },
    finish(deadlineMs = null) {
      if (finished) return null;
      active = false;
      finished = true;
      return summarize(deadlineMs);
    },
  };
}

/** Stop only the supplied browser process tree and report observed confirmation. */
export async function stopOwnedRecoveryProcessTree(
  child,
  {
    platform = process.platform,
    spawnImpl = defaultSpawn,
    killProcess = process.kill,
    helperTimeoutMs = 2000,
    exitTimeoutMs = 1500,
  } = {},
) {
  if (!child)
    return { attempted: false, confirmed: false, reason: 'missing-process' };
  if (child.exitCode != null || child.signalCode != null)
    return { attempted: false, confirmed: true, reason: 'already-exited' };
  if (!Number.isInteger(child.pid) || child.pid < 1)
    return { attempted: false, confirmed: false, reason: 'missing-pid' };

  let terminationRequested = false;
  if (platform === 'win32') {
    const code = await new Promise((resolve) => {
      let killer;
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killer?.off('error', onError);
        killer?.off('exit', onExit);
        resolve(result);
      };
      const onError = () => finish(null);
      const onExit = (value) => finish(value);
      try {
        killer = spawnImpl(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true,
          },
        );
      } catch {
        finish(null);
        return;
      }
      timer = setTimeout(() => {
        finish(null);
        try {
          killer.kill();
        } catch {}
      }, helperTimeoutMs);
      killer.once('error', onError);
      killer.once('exit', onExit);
    });
    terminationRequested = code === 0;
    if (!terminationRequested)
      return {
        attempted: true,
        confirmed: false,
        reason:
          child.exitCode != null || child.signalCode != null
            ? 'exit-during-failed-request'
            : 'request-failed',
      };
  } else {
    try {
      killProcess(-child.pid, 'SIGTERM');
      terminationRequested = true;
    } catch {
      return { attempted: true, confirmed: false, reason: 'request-failed' };
    }
  }

  const exitObserved = await new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null)
      return resolve(true);
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, exitTimeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
  return {
    attempted: terminationRequested,
    confirmed: exitObserved,
    reason: exitObserved ? 'process-exit-observed' : 'exit-not-observed',
  };
}

export async function closeRecoveryBrowser(
  browser,
  {
    timeoutMs = 5000,
    forceProcess,
    now = () => performance.now(),
    closeTrace = null,
    shutdownDiagnostics = null,
    platform = process.platform,
    killProcess = process.kill,
    processInfoTimeoutMs = SYSTEM_INFO_PROCESS_TIMEOUT_MS,
    postDisconnectExitTimeoutMs = 5000,
  } = {},
) {
  const child = browser.process?.() ?? null;
  const helperStartedAt = now();
  let processExit = null;
  const initialExit = () => {
    const code = child?.exitCode;
    const signal = child?.signalCode;
    return code != null || signal != null ? { code, signal } : null;
  };
  processExit = initialExit();
  const processExitedBeforeClose = processExit !== null;
  if (processExit) processExit = { ...processExit, elapsedMs: null };
  const onExit = (code, signal) => {
    processExit = {
      code,
      signal,
      elapsedMs: Math.max(0, now() - helperStartedAt),
    };
  };
  if (!processExit) child?.once?.('exit', onExit);
  const targetTypeCounts = {};
  const ownedPidPresence = {};
  let diagnosticProcessTree = null;
  let browserProcessInfoBeforeClose = null;
  let preCloseDiagnosticsElapsedMs = null;
  let disconnected = false;
  const diagnosticsEnabled = Boolean(shutdownDiagnostics);
  const unavailable = (reason) => unavailableSnapshot(reason);
  const captureTargets = (phase) => {
    if (!diagnosticsEnabled) return;
    try {
      targetTypeCounts[phase] = disconnected
        ? unavailable('browser-disconnected')
        : targetTypeSnapshot(browser);
    } catch {
      targetTypeCounts[phase] = unavailable('target-snapshot-failed');
    }
  };
  const onDisconnected = () => {
    disconnected = true;
    closeTrace?.recordDisconnected?.();
    if (diagnosticsEnabled)
      targetTypeCounts.atDisconnect = unavailable('browser-disconnected');
  };

  const captureOwnedPidPresence = (phase) => {
    if (!diagnosticsEnabled) return;
    try {
      ownedPidPresence[phase] = observeOwnedBrowserPidPresence(child, {
        platform,
        killProcess,
      });
    } catch {
      ownedPidPresence[phase] = unavailable('owned-pid-presence-check-failed');
    }
  };

  const settleWithin = async (operation, deadlineMs = timeoutMs) => {
    let timer;
    const settled = Promise.resolve()
      .then(operation)
      .then(
        (value) => ({ kind: 'resolved', value }),
        (error) => ({ kind: 'rejected', error }),
      );
    try {
      return await Promise.race([
        settled,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'timeout' }), deadlineMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const acknowledgedCloseDisconnect = (trace) =>
    trace?.browserCloseRequestSeen === true &&
    trace.browserCloseAcknowledgementSeen === true &&
    trace.browserCloseAcknowledgementError === false &&
    trace.browserDisconnected === true &&
    trace.malformedCloseMessage === false &&
    trace.protocolObservationComplete === true;

  let forcedProcessTermination = false;
  let forceProcessStatus = forceProcess ? 'not-needed' : 'not-configured';
  let forceProcessAttempted = false;
  let forceProcessCallbackInvoked = false;
  try {
    browser.on?.('disconnected', onDisconnected);
    captureTargets('beforeClose');
    if (diagnosticsEnabled) {
      const diagnosticsStartedAt = now();
      browserProcessInfoBeforeClose = await captureBrowserProcessInfo(
        shutdownDiagnostics?.systemInfoSnapshot,
        processInfoTimeoutMs,
      );
      preCloseDiagnosticsElapsedMs = Math.max(0, now() - diagnosticsStartedAt);
    }
    const closeStartedAt = now();
    closeTrace?.begin?.();
    const closePromise = Promise.resolve().then(() => browser.close());
    let closeResult = await settleWithin(() => closePromise);
    let postDisconnectExitWaitAttempted = false;
    if (
      closeResult.kind === 'timeout' &&
      Number.isFinite(postDisconnectExitTimeoutMs) &&
      postDisconnectExitTimeoutMs > 0 &&
      acknowledgedCloseDisconnect(closeTrace?.snapshot?.(timeoutMs))
    ) {
      // Browser.close has already been accepted and the protocol transport has
      // disconnected. Give the owned process a separate bounded drain window
      // for profile/file teardown before treating it as a hung close.
      postDisconnectExitWaitAttempted = true;
      closeResult = await settleWithin(
        () => closePromise,
        postDisconnectExitTimeoutMs,
      );
    }
    const closeCompleted = closeResult.kind === 'resolved';
    const closeStatus = closeCompleted
      ? 'completed'
      : closeResult.kind === 'timeout'
        ? 'timed-out'
        : 'rejected';
    const closeSettledAt = now();
    const closeElapsedMs = Math.max(0, closeSettledAt - closeStartedAt);
    let closeRejectionName = null;
    let forceProcessElapsedMs = null;

    if (closeResult.kind === 'rejected') {
      const name = closeResult.error?.name;
      closeRejectionName =
        typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name)
          ? name.slice(0, 48)
          : 'Error';
    }

    if (!closeCompleted) {
      captureTargets(
        closeResult.kind === 'timeout' ? 'atTimeout' : 'atCloseFailure',
      );
      if (diagnosticsEnabled) {
        captureOwnedPidPresence(
          closeResult.kind === 'timeout' ? 'atTimeout' : 'atCloseFailure',
        );
        try {
          diagnosticProcessTree =
            typeof shutdownDiagnostics?.processTreeSnapshot === 'function'
              ? shutdownDiagnostics.processTreeSnapshot(child)
              : captureOwnedBrowserProcessTree(child);
        } catch {
          diagnosticProcessTree = unavailable('process-snapshot-failed');
        }
      }
    }

    if (!closeCompleted && forceProcess) {
      const currentExit = initialExit();
      if (currentExit) {
        forceProcessStatus = 'already-exited';
      } else {
        forceProcessCallbackInvoked = true;
        forceProcessAttempted = true;
        const forceStartedAt = now();
        const forceResult = await settleWithin(forceProcess);
        forceProcessElapsedMs = Math.max(0, now() - forceStartedAt);
        if (forceResult.kind === 'timeout') {
          forceProcessStatus = 'timed-out';
        } else if (forceResult.kind === 'rejected') {
          forceProcessStatus = 'rejected';
        } else if (
          forceResult.value?.reason === 'already-exited' ||
          (forceResult.value?.attempted === false &&
            forceResult.value?.confirmed === true)
        ) {
          forceProcessAttempted = false;
          forceProcessStatus = 'already-exited';
        } else if (
          forceResult.value?.attempted === true &&
          forceResult.value?.confirmed === true
        ) {
          forceProcessStatus = 'confirmed';
          forcedProcessTermination = true;
        } else {
          forceProcessStatus = 'unconfirmed';
        }
      }
    }

    if (!closeCompleted) captureOwnedPidPresence('afterForceCheckpoint');

    processExit ||= initialExit();
    const protocolCloseTrace = closeTrace?.finish?.(timeoutMs) ?? null;
    return {
      closeCompleted,
      forcedProcessTermination,
      observation: {
        closeStatus,
        closeDeadlineMs: timeoutMs,
        effectiveCloseDeadlineMs:
          timeoutMs +
          (postDisconnectExitWaitAttempted ? postDisconnectExitTimeoutMs : 0),
        postDisconnectExitTimeoutMs,
        postDisconnectExitWaitAttempted,
        closeStartHostMs: closeStartedAt,
        closeSettledHostMs: closeSettledAt,
        closeElapsedMs,
        timingOrigins: {
          closeElapsedMs: 'browser.close invocation',
          processExitElapsedMs: 'closeRecoveryBrowser entry',
          ...(diagnosticsEnabled
            ? {
                preCloseDiagnosticsElapsedMs:
                  'bounded shutdown diagnostics before Browser.close invocation',
              }
            : {}),
        },
        closeRejectionName,
        processExitedBeforeClose,
        processExit,
        protocolCloseTrace,
        ...(diagnosticsEnabled
          ? {
              shutdownDiagnostics: {
                targetTypeCounts,
                browserProcessInfoBeforeClose:
                  browserProcessInfoBeforeClose || unavailable('not-captured'),
                preCloseDiagnosticsElapsedMs,
                ownedPidPresence,
                processTreeBeforeForce: diagnosticProcessTree,
              },
            }
          : {}),
        forceProcessStatus,
        forceProcessAttempted,
        forceProcessCallbackInvoked,
        forceProcessElapsedMs,
      },
    };
  } finally {
    closeTrace?.finish?.(timeoutMs);
    browser.off?.('disconnected', onDisconnected);
    child?.off?.('exit', onExit);
  }
}

export function applyRecoveryCleanupFailure(check, cleanupError) {
  if (!check) return { becamePrimaryFailure: false, shouldThrow: false };
  check.pageOwnership ||= {};
  check.pageOwnership.cleanupError = cleanupError.message.slice(0, 240);
  if (check.status !== 'passed')
    return { becamePrimaryFailure: false, shouldThrow: false };
  check.status = 'failed';
  check.step = 'owned-page-cleanup';
  check.error = cleanupError.message;
  return { becamePrimaryFailure: true, shouldThrow: true };
}

export function recoveryPageCleanupError({
  closeCompleted,
  openPageCount,
  unexpectedCreatedPageTargets,
  browserCloseCompleted,
  closeObservation,
}) {
  if (!closeCompleted || openPageCount !== 0)
    return new Error(
      `Owned fixture page cleanup failed before browser close (pageClose=${closeObservation?.status ?? 'unknown'}, closed=${closeCompleted}, remaining=${openPageCount}).`,
    );
  if (unexpectedCreatedPageTargets > 0)
    return new Error(
      `Unexpected page targets were created during this recovery stage (${unexpectedCreatedPageTargets}).`,
    );
  if (browserCloseCompleted === false)
    return new Error('Graceful browser close did not complete.');
  return null;
}
