import { isStandaloneAndroidApk } from './standaloneApkApi';

export type OperationMode = 'remote' | 'standalone';

export type ConnectionHealthStatus =
  | 'untested'
  | 'checking'
  | 'connected'
  | 'unreachable'
  | 'standalone_local';

export interface ServerConfigState {
  mode: OperationMode;
  remoteServerUrl: string | null;
  lastVerifiedAt: string | null;
  lastHealthStatus: ConnectionHealthStatus;
  lastError: string | null;
}

const SERVER_CONFIG_STORAGE_KEY = 'shakti_server_config_v1';
export const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Validates and normalizes a remote server URL.
 * Enforces HTTPS for all remote endpoints (only allows http:// for localhost / 127.0.0.1 in local dev).
 */
export function validateRemoteServerUrl(rawUrl: string): {
  valid: boolean;
  normalizedOrigin: string | null;
  apiBaseUrl: string | null;
  error: string | null;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedOrigin: null,
      apiBaseUrl: null,
      error: 'Server URL cannot be empty.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedOrigin: null,
      apiBaseUrl: null,
      error: 'Invalid URL format. Include https:// (e.g., https://shakti.duckdns.org).',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedOrigin: null,
      apiBaseUrl: null,
      error: 'Credentials in server URL are not permitted.',
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

  if (protocol !== 'https:' && !(protocol === 'http:' && isLocalhost)) {
    return {
      valid: false,
      normalizedOrigin: null,
      apiBaseUrl: null,
      error: 'HTTPS is required for remote safety servers to protect location and alert data.',
    };
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  const normalizedOrigin = `${parsed.protocol}//${parsed.host}${cleanPath}`;
  const apiBaseUrl = `${normalizedOrigin}/api`;

  return {
    valid: true,
    normalizedOrigin,
    apiBaseUrl,
    error: null,
  };
}

function getDefaultServerConfig(): ServerConfigState {
  const envUrl = (
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_REMOTE_SERVER_URL || ''
  ).trim();

  if (envUrl) {
    const validated = validateRemoteServerUrl(envUrl);
    if (validated.valid && validated.normalizedOrigin) {
      return {
        mode: 'remote',
        remoteServerUrl: validated.normalizedOrigin,
        lastVerifiedAt: null,
        lastHealthStatus: 'untested',
        lastError: null,
      };
    }
  }

  if (isStandaloneAndroidApk()) {
    return {
      mode: 'standalone',
      remoteServerUrl: null,
      lastVerifiedAt: null,
      lastHealthStatus: 'standalone_local',
      lastError: null,
    };
  }

  return {
    mode: 'remote',
    remoteServerUrl: null,
    lastVerifiedAt: null,
    lastHealthStatus: 'untested',
    lastError: null,
  };
}

export function getServerConfig(): ServerConfigState {
  if (typeof window === 'undefined') {
    return getDefaultServerConfig();
  }
  try {
    const raw = window.localStorage.getItem(SERVER_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ServerConfigState>;
      if (parsed.mode === 'standalone' || parsed.mode === 'remote') {
        if (parsed.remoteServerUrl) {
          const check = validateRemoteServerUrl(parsed.remoteServerUrl);
          if (!check.valid) {
            return getDefaultServerConfig();
          }
        }
        return {
          mode: parsed.mode,
          remoteServerUrl: parsed.remoteServerUrl ?? null,
          lastVerifiedAt: parsed.lastVerifiedAt ?? null,
          lastHealthStatus:
            parsed.lastHealthStatus ??
            (parsed.mode === 'standalone' ? 'standalone_local' : 'untested'),
          lastError: parsed.lastError ?? null,
        };
      }
    }
  } catch {
    // ignore storage read errors
  }
  return getDefaultServerConfig();
}

export function saveServerConfig(next: ServerConfigState): ServerConfigState {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        SERVER_CONFIG_STORAGE_KEY,
        JSON.stringify(next)
      );
    } catch {
      // ignore storage write errors
    }
  }
  return next;
}

export function resolveEffectiveApiBaseUrl(): string {
  const cfg = getServerConfig();
  if (cfg.mode === 'remote' && cfg.remoteServerUrl) {
    const check = validateRemoteServerUrl(cfg.remoteServerUrl);
    if (check.valid && check.apiBaseUrl) {
      return check.apiBaseUrl;
    }
  }
  return (
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_API_BASE_URL || '/api'
  );
}

export function resolveEffectiveWebSocketUrl(wsPath: string): string {
  const cleanWsPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  const cfg = getServerConfig();
  if (cfg.mode === 'remote' && cfg.remoteServerUrl) {
    const check = validateRemoteServerUrl(cfg.remoteServerUrl);
    if (check.valid && check.normalizedOrigin) {
      const u = new URL(check.normalizedOrigin);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}${u.pathname === '/' ? '' : u.pathname}${cleanWsPath}`;
    }
  }
  if (typeof window !== 'undefined' && window.location?.host) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}${cleanWsPath}`;
  }
  return `ws://localhost:3000${cleanWsPath}`;
}

export async function checkRemoteServerHealth(
  targetUrl?: string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS
): Promise<{
  reachable: boolean;
  latencyMs: number;
  service: string | null;
  error: string | null;
}> {
  let healthEndpoint = '/api/health';
  if (targetUrl && targetUrl.trim()) {
    const validated = validateRemoteServerUrl(targetUrl);
    if (!validated.valid || !validated.apiBaseUrl) {
      return {
        reachable: false,
        latencyMs: 0,
        service: null,
        error: validated.error || 'Invalid server URL',
      };
    }
    healthEndpoint = `${validated.apiBaseUrl}/health`;
  } else {
    healthEndpoint = `${resolveEffectiveApiBaseUrl()}/health`;
  }

  const startMs = Date.now();
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const res = await fetchImpl(healthEndpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const latencyMs = Math.max(1, Date.now() - startMs);

    if (!res.ok) {
      return {
        reachable: false,
        latencyMs,
        service: null,
        error: `Server responded with HTTP ${res.status}`,
      };
    }

    const body = (await res.json()) as { status?: string; service?: string };
    if (body?.status !== 'ok') {
      return {
        reachable: false,
        latencyMs,
        service: null,
        error: 'Unexpected health check response payload.',
      };
    }

    return {
      reachable: true,
      latencyMs,
      service: body.service || 'saathi-api',
      error: null,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startMs);
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || /aborted|timeout/i.test(err.message));
    return {
      reachable: false,
      latencyMs,
      service: null,
      error: isAbort
        ? `Connection timed out after ${Math.round(timeoutMs / 1000)}s`
        : 'Server unreachable. Verify HTTPS URL and network connection.',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SwitchServerConfigOptions {
  mode: OperationMode;
  remoteServerUrl?: string | null;
  pendingQueueCount: number;
  allowDiscardPendingQueue?: boolean;
}

export interface SwitchServerConfigResult {
  switched: boolean;
  requiresQueueConfirmation: boolean;
  error: string | null;
  config: ServerConfigState;
}

/**
 * Safely switches between Standalone Local Mode and Remote Server Mode.
 * Never sends queued alerts to a newly changed server URL without explicit confirmation.
 */
export function switchServerConfiguration(
  options: SwitchServerConfigOptions
): SwitchServerConfigResult {
  const current = getServerConfig();

  let normalizedRemote: string | null = null;
  if (options.mode === 'remote' && options.remoteServerUrl?.trim()) {
    const check = validateRemoteServerUrl(options.remoteServerUrl);
    if (!check.valid || !check.normalizedOrigin) {
      return {
        switched: false,
        requiresQueueConfirmation: false,
        error: check.error || 'Invalid remote server URL',
        config: current,
      };
    }
    normalizedRemote = check.normalizedOrigin;
  }

  const targetChanged =
    current.mode !== options.mode ||
    (current.remoteServerUrl || null) !== normalizedRemote;

  if (
    targetChanged &&
    options.pendingQueueCount > 0 &&
    !options.allowDiscardPendingQueue
  ) {
    return {
      switched: false,
      requiresQueueConfirmation: true,
      error:
        'You have pending queued SOS alerts. Flush or clear the offline queue before switching to a different server so alerts are never sent to an unintended server.',
      config: current,
    };
  }

  const updated: ServerConfigState = {
    mode: options.mode,
    remoteServerUrl: options.mode === 'remote' ? normalizedRemote : null,
    lastVerifiedAt:
      options.mode === 'remote' &&
      normalizedRemote === current.remoteServerUrl
        ? current.lastVerifiedAt
        : null,
    lastHealthStatus:
      options.mode === 'standalone' ? 'standalone_local' : 'untested',
    lastError: null,
  };

  return {
    switched: true,
    requiresQueueConfirmation: false,
    error: null,
    config: saveServerConfig(updated),
  };
}
