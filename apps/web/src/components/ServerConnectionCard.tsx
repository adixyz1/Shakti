import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Smartphone } from 'lucide-react';
import { Button, Card, Input } from './ui';
import {
  checkRemoteServerHealth,
  getServerConfig,
  saveServerConfig,
  switchServerConfiguration,
  type ServerConfigState,
} from '../lib/serverConfig';
import {
  clearAllQueuedAlerts,
  flushOfflineAlertQueue,
  listQueuedAlerts,
} from '../lib/offlineQueue';

export const ServerConnectionCard: React.FC = () => {
  const [config, setConfig] = useState<ServerConfigState>(() =>
    getServerConfig()
  );
  const [urlInput, setUrlInput] = useState<string>(
    () => getServerConfig().remoteServerUrl || ''
  );
  const [isTesting, setIsTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);
  const [requiresQueueConfirm, setRequiresQueueConfirm] = useState(false);

  const refreshQueueCount = async () => {
    const q = await listQueuedAlerts();
    setPendingQueueCount(q.length);
    return q.length;
  };

  useEffect(() => {
    void refreshQueueCount();
  }, []);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const target = urlInput.trim() || config.remoteServerUrl;
      const res = await checkRemoteServerHealth(target);
      if (res.reachable) {
        const nowIso = new Date().toISOString();
        const updated = saveServerConfig({
          ...config,
          lastVerifiedAt: nowIso,
          lastHealthStatus: 'connected',
          lastError: null,
        });
        setConfig(updated);
        setStatusMessage(
          `Connected to live server (${res.latencyMs} ms) — API healthy`
        );
      } else {
        const updated = saveServerConfig({
          ...config,
          lastHealthStatus: 'unreachable',
          lastError: res.error,
        });
        setConfig(updated);
        setErrorMessage(res.error || 'Server unreachable');
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleApplyMode = async (
    targetMode: 'remote' | 'standalone',
    allowDiscardQueue: boolean = false
  ) => {
    setErrorMessage(null);
    setStatusMessage(null);
    const qCount = await refreshQueueCount();

    const result = switchServerConfiguration({
      mode: targetMode,
      remoteServerUrl: targetMode === 'remote' ? urlInput.trim() || null : null,
      pendingQueueCount: qCount,
      allowDiscardPendingQueue: allowDiscardQueue,
    });

    if (!result.switched) {
      setRequiresQueueConfirm(result.requiresQueueConfirmation);
      setErrorMessage(result.error);
      return;
    }

    if (allowDiscardQueue && qCount > 0) {
      await clearAllQueuedAlerts();
      await refreshQueueCount();
    }

    setRequiresQueueConfirm(false);
    setConfig(result.config);
    setStatusMessage(
      targetMode === 'standalone'
        ? 'Switched to Standalone Device Mode (100% local storage on this phone).'
        : result.config.remoteServerUrl
          ? `Configured Remote HTTPS Server: ${result.config.remoteServerUrl}`
          : 'Configured default same-origin server API (/api).'
    );
  };

  return (
    <Card
      data-testid="hybrid-server-connection-card"
      className="space-y-4 border-slate-200 dark:border-slate-800"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Server Connection & Hybrid Sync
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Operate standalone on this device or sync with your HTTPS Oracle Cloud server. Remote URLs require HTTPS.
          </p>
        </div>

        <span
          data-testid="server-connection-mode-badge"
          className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${
            config.mode === 'standalone'
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
              : config.lastHealthStatus === 'connected'
                ? 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200'
                : config.lastHealthStatus === 'unreachable'
                  ? 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200'
                  : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
          }`}
        >
          {config.mode === 'standalone'
            ? 'Standalone Local'
            : config.lastHealthStatus === 'connected'
              ? 'Remote Connected'
              : config.lastHealthStatus === 'unreachable'
                ? 'Remote Unreachable'
                : 'Remote Mode'}
        </span>
      </div>

      <div className="space-y-3">
        <Input
          label="Remote HTTPS Server URL (Optional for Android APK)"
          data-testid="remote-server-url-input"
          type="url"
          placeholder="https://shakti.duckdns.org or https://129.154.x.x.nip.io"
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value);
            setErrorMessage(null);
            setStatusMessage(null);
          }}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <Button
            type="button"
            variant="primary"
            data-testid="save-remote-server-btn"
            onClick={() => void handleApplyMode('remote', false)}
          >
            Use Remote Server
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid="use-standalone-mode-btn"
            onClick={() => void handleApplyMode('standalone', false)}
          >
            Standalone Mode
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="test-server-health-btn"
            isLoading={isTesting}
            onClick={() => void handleTestConnection()}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Test Health
          </Button>
        </div>
      </div>

      {requiresQueueConfirm && pendingQueueCount > 0 && (
        <div
          role="alert"
          data-testid="server-switch-queue-warning"
          className="rounded-xl border border-amber-500 bg-amber-50 dark:bg-amber-950/60 p-3.5 space-y-2.5"
        >
          <p className="text-xs font-bold text-amber-950 dark:text-amber-100">
            Pending Offline Queue Detected ({pendingQueueCount} alert{pendingQueueCount === 1 ? '' : 's'})
          </p>
          <p className="text-xs text-amber-900 dark:text-amber-200">
            To prevent sending queued emergency data to an unintended server, flush the queue to your current server first or confirm clearing the pending queue.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              data-testid="flush-before-switch-btn"
              onClick={async () => {
                await flushOfflineAlertQueue();
                await refreshQueueCount();
              }}
            >
              Flush Queue Now
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="confirm-discard-queue-switch-btn"
              onClick={() =>
                void handleApplyMode(
                  config.mode === 'remote' ? 'standalone' : 'remote',
                  true
                )
              }
            >
              Clear Queue & Switch
            </Button>
          </div>
        </div>
      )}

      {statusMessage && (
        <p
          role="status"
          data-testid="server-connection-status-msg"
          className="text-xs font-semibold text-teal-800 dark:text-teal-300 flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </p>
      )}

      {errorMessage && (
        <p
          role="alert"
          data-testid="server-connection-error-msg"
          className="text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </p>
      )}
    </Card>
  );
};
