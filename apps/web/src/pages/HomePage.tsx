import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Delete,
  MapPin,
  MessageSquare,
  Phone,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import { BigButton, Button, Card, Spinner } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import { PostIncidentRatingCard } from '../components/PostIncidentRatingCard';
import { ClosedAlertSupportCard } from '../components/ClosedAlertSupportCard';
import { FakeCallModal } from '../components/FakeCallModal';
import { LoudAlarmModal } from '../components/LoudAlarmModal';
import { createAudioContext } from '../lib/safetyAudio';
import { useAuthStore } from '../store/authStore';
import {
  ApiError,
  consentsApi,
  contactsApi,
  incidentsApi,
  type IncidentDto,
  type LocationSampleDto,
  type TrustedContact,
} from '../lib/api';
import {
  isOpenIncident,
  subscribeSosTrigger,
  triggerSos,
} from '../lib/sos';
import {
  buildEmergencySmsBody,
  buildSmsFallbackHref,
  cancelQueuedAlert,
  detectSmsPlatform,
  flushOfflineAlertQueue,
  getCachedEmergencyContacts,
  getGuestEmergencyContacts,
  listQueuedAlerts,
  subscribeQueueChange,
  subscribeQueueFlushed,
  syncOfflineEmergencyContactsCache,
  updateQueuedAlertEmergencyType,
  updateQueuedAlertLocation,
  type CachedEmergencyContact,
  type QueuedSosAlert,
} from '../lib/offlineQueue';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import { DisguiseCalculator } from '../components/DisguiseCalculator';
import { SafetyPulseCard } from '../components/SafetyPulseCard';
import { DemoSimulatePanel } from '../components/DemoSimulatePanel';
import { GuestContactsCard } from '../components/GuestContactsCard';
import { SignInLaterOfferCard } from '../components/SignInLaterOfferCard';

const HOLD_DURATION_MS = 2000;
const HOLD_TICK_MS = 100;
const EMERGENCY_TYPES = [
  'unsafe',
  'followed',
  'harassment',
  'medical',
  'other',
] as const;

export { triggerSos };

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    disguiseEnabled,
    disguiseUnlockedSession,
    disguiseSequenceHash,
    lowPowerDataSaverMode,
    setDisguiseUnlockedSession,
  } = useTriggerSettingsStore();

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<'load' | 'trigger' | null>(
    null
  );

  const [incident, setIncident] = useState<IncidentDto | null>(null);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [cachedContacts, setCachedContacts] = useState<
    CachedEmergencyContact[]
  >([]);
  const [guestContacts, setGuestContacts] = useState<
    CachedEmergencyContact[]
  >([]);
  const [isCapturingGuestLocation, setIsCapturingGuestLocation] = useState(false);
  const [guestLocationError, setGuestLocationError] = useState<string | null>(null);
  const [notifiableCount, setNotifiableCount] = useState<number>(0);
  const [locationConsentGranted, setLocationConsentGranted] =
    useState<boolean>(false);

  // Offline Queue & SMS Fallback state (Phase 5)
  const [queuedAlerts, setQueuedAlerts] = useState<QueuedSosAlert[]>([]);
  const [sentAtTime, setSentAtTime] = useState<string | null>(null);
  const [smsComposerOpened, setSmsComposerOpened] = useState(false);
  const [smsConfirmedAt, setSmsConfirmedAt] = useState<string | null>(null);

  // Hold-to-trigger state
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [srAnnouncement, setSrAnnouncement] = useState('');
  const [isSubmittingSos, setIsSubmittingSos] = useState(false);

  const isHoldingRef = useRef(false);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cancel window & PIN keypad state
  const [cancelSecondsLeft, setCancelSecondsLeft] = useState<number>(5);
  const [showPinKeypad, setShowPinKeypad] = useState(false);
  const [pinDigits, setPinDigits] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  // Location capture during alert
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'off' | 'capturing' | 'active' | 'unavailable'
  >('idle');
  const [latestLocation, setLatestLocation] =
    useState<LocationSampleDto | null>(null);
  const [silentDuressIncidentId, setSilentDuressIncidentId] = useState<
    string | null
  >(null);

  // Phase 10A: Secondary Safety Tools (Fake Call & Loud Alarm)
  const [showFakeCall, setShowFakeCall] = useState(false);
  const [fakeCallAudioCtx, setFakeCallAudioCtx] = useState<AudioContext | null>(null);
  const [showLoudAlarm, setShowLoudAlarm] = useState(false);

  const handleFakeCallClick = () => {
    // Crucial: create AudioContext on this user gesture tap
    const ctx = createAudioContext();
    setFakeCallAudioCtx(ctx);
    setShowFakeCall(true);
  };

  const handleLoudAlarmClick = () => {
    setShowLoudAlarm(true);
  };

  const refreshQueuedAlertsState = useCallback(async () => {
    const q = await listQueuedAlerts();
    setQueuedAlerts(q);
    const cached = await getCachedEmergencyContacts();
    setCachedContacts(cached);
  }, []);

  useEffect(() => {
    void refreshQueuedAlertsState();
    const unsubChange = subscribeQueueChange(() => {
      void refreshQueuedAlertsState();
    });
    const unsubFlushed = subscribeQueueFlushed((_reqId, response) => {
      setIncident(response.incident);
      if (response.notifiable_contacts_count !== undefined) {
        setNotifiableCount(response.notifiable_contacts_count);
      }
      setSentAtTime(
        new Date(
          response.incident.activated_at || response.incident.created_at
        ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      setServerError(null);
      setFailedAction(null);
      void refreshQueuedAlertsState();
    });
    return () => {
      unsubChange();
      unsubFlushed();
    };
  }, [refreshQueuedAlertsState]);

  const loadSafetyOverview = useCallback(async () => {
    setServerError(null);
    setFailedAction(null);
    setIsInitialLoading(true);
    try {
      const [activeRes, contactsRes, consentsRes] = await Promise.all([
        incidentsApi.getActiveIncident(),
        contactsApi.listContacts(),
        consentsApi.getConsents(),
      ]);

      setIncident((prev) => {
        if (activeRes.incident) {
          return activeRes.incident;
        }
        if (prev && prev.id.startsWith('queued_')) {
          return prev;
        }
        return null;
      });
      setContacts(contactsRes.contacts || []);

      const dataProcessingConsent =
        consentsRes.current?.data_processing !== false;
      const syncedCache = await syncOfflineEmergencyContactsCache(
        contactsRes.contacts || [],
        dataProcessingConsent
      );
      setCachedContacts(syncedCache);

      const acceptedSosCount =
        activeRes.notifiable_contacts_count ??
        contactsRes.notifiable_contacts_count ??
        syncedCache.length;

      setNotifiableCount(acceptedSosCount);
      setLocationConsentGranted(Boolean(consentsRes.current?.location));

      if (
        activeRes.incident?.locations &&
        activeRes.incident.locations.length > 0
      ) {
        const last =
          activeRes.incident.locations[activeRes.incident.locations.length - 1];
        setLatestLocation(last);
      }
    } catch {
      // Load cached emergency contacts from IndexedDB if offline
      const cached = await getCachedEmergencyContacts();
      setCachedContacts(cached);
      if (cached.length > 0) {
        setNotifiableCount(cached.length);
      }
      const q = await listQueuedAlerts();
      setQueuedAlerts(q);
      if (q.length === 0) {
        setServerError(t('sos.error.serverUnreachableBody'));
        setFailedAction('load');
      }
    } finally {
      setIsInitialLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (user) {
      void loadSafetyOverview();
    } else {
      const loadGuestData = async () => {
        setIsInitialLoading(true);
        try {
          const guest = await getGuestEmergencyContacts();
          setGuestContacts(guest);
          setNotifiableCount(guest.length);
        } catch {
          // ignore
        } finally {
          setIsInitialLoading(false);
        }
      };
      void loadGuestData();
    }
  }, [user, loadSafetyOverview]);

  const handleGuestIncludeLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGuestLocationError(t('guestSos.locationUnavailable'));
      return;
    }
    setIsCapturingGuestLocation(true);
    setGuestLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationConsentGranted(true);
        const sample: LocationSampleDto = {
          id: `guest_loc_${Date.now()}`,
          incident_id: incident?.id || 'guest',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
          captured_at: new Date().toISOString(),
          expires_at: Date.now() + 600000,
        };
        setLatestLocation(sample);
        setLocationStatus('active');
        setIsCapturingGuestLocation(false);
      },
      (err) => {
        setLocationStatus('unavailable');
        setGuestLocationError(err?.message || t('guestSos.locationFailed'));
        setIsCapturingGuestLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Listen to unified triggerSos(source) calls
  useEffect(() => {
    return subscribeSosTrigger((res) => {
      setIncident(res.incident);
      if (res.notifiable_contacts_count !== undefined) {
        setNotifiableCount(res.notifiable_contacts_count);
      }
      if (!res.queued_offline) {
        setSentAtTime(
          new Date(res.incident.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        );
      } else {
        setSentAtTime(null);
      }
      setSmsComposerOpened(false);
      setSmsConfirmedAt(null);
      const defaultSec = user
        ? (user.cancel_window_seconds ?? 5)
        : useTriggerSettingsStore.getState().guestCancelWindowSeconds;
      setCancelSecondsLeft(defaultSec);
      setShowPinKeypad(false);
      setPinDigits('');
      setPinError(null);
      setServerError(null);
      setFailedAction(null);
      void refreshQueuedAlertsState();
    });
  }, [user?.cancel_window_seconds, refreshQueuedAlertsState]);

  const clearHoldTimers = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearHoldTimers();
    };
  }, [clearHoldTimers]);

  const executeTrigger = useCallback(
    async (source: string = 'button') => {
      setIsSubmittingSos(true);
      setServerError(null);
      setFailedAction(null);
      try {
        await triggerSos(source);
      } catch {
        setServerError(t('sos.error.serverUnreachableBody'));
        setFailedAction('trigger');
      } finally {
        setIsSubmittingSos(false);
      }
    },
    [t]
  );

  const startHold = useCallback(() => {
    if (isHoldingRef.current || isSubmittingSos) return;
    isHoldingRef.current = true;
    setIsHolding(true);
    setHoldProgress(0);
    setSrAnnouncement(t('sos.srHoldStarted'));

    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    } catch {
      // ignore vibration errors
    }

    let step = 0;
    const totalSteps = HOLD_DURATION_MS / HOLD_TICK_MS;

    holdIntervalRef.current = setInterval(() => {
      step += 1;
      const pct = Math.min(100, Math.round((step / totalSteps) * 100));
      setHoldProgress(pct);
    }, HOLD_TICK_MS);

    holdTimeoutRef.current = setTimeout(() => {
      clearHoldTimers();
      isHoldingRef.current = false;
      setIsHolding(false);
      setHoldProgress(100);
      setSrAnnouncement(t('sos.srHoldTriggered'));
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([120, 60, 120]);
        }
      } catch {
        // ignore vibration errors
      }
      void executeTrigger('button');
    }, HOLD_DURATION_MS);
  }, [clearHoldTimers, executeTrigger, isSubmittingSos, t]);

  const cancelHoldEarly = useCallback(() => {
    if (!isHoldingRef.current) return;
    clearHoldTimers();
    isHoldingRef.current = false;
    setIsHolding(false);
    setHoldProgress(0);
    setSrAnnouncement(t('sos.srHoldReleasedEarly'));
  }, [clearHoldTimers, t]);

  const isCurrentIncidentQueued = Boolean(
    incident?.id?.startsWith('queued_') || queuedAlerts.length > 0
  );

  // Cancel window countdown timer while incident is TRIGGERED
  useEffect(() => {
    if (!incident || incident.status !== 'TRIGGERED') {
      return;
    }

    const windowSec = user
      ? (user.cancel_window_seconds ?? 5)
      : useTriggerSettingsStore.getState().guestCancelWindowSeconds;
    setCancelSecondsLeft(windowSec);

    const intervalId = setInterval(() => {
      setCancelSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          if (incident.id.startsWith('guest_')) {
            setIncident((prevInc) =>
              prevInc
                ? {
                    ...prevInc,
                    status: 'ACTIVE',
                    activated_at: new Date().toISOString(),
                  }
                : null
            );
            setSentAtTime(
              new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            );
            return 0;
          }

          if (!incident.id.startsWith('queued_')) {
            // Sync incident status once cancel window elapses
            void incidentsApi
              .getIncident(incident.id)
              .then((res) => {
                setIncident(res.incident);
                if (res.incident.activated_at) {
                  setSentAtTime(
                    new Date(res.incident.activated_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  );
                }
              })
              .catch(() => {
                // ignore transient poll errors; WebSocket or retry handles it
              });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [incident?.id, incident?.status, user?.cancel_window_seconds]);

  // Realtime WebSocket connection + reconnect for open server-side incidents
  useEffect(() => {
    if (
      !incident ||
      !isOpenIncident(incident) ||
      incident.id.startsWith('queued_') ||
      incident.id.startsWith('guest_')
    ) {
      return;
    }

    let unmounted = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      if (
        unmounted ||
        typeof window === 'undefined' ||
        !('WebSocket' in window)
      ) {
        return;
      }
      try {
        const protocol =
          window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        ws = new WebSocket(`${protocol}//${host}/ws/incidents/${incident.id}`);

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data));
            if (
              (payload.type === 'incident_state' ||
                payload.type === 'incident_updated') &&
              payload.incident
            ) {
              setIncident(payload.incident);
              if (payload.incident.notifiable_contacts_count !== undefined) {
                setNotifiableCount(payload.incident.notifiable_contacts_count);
              }
            }
          } catch {
            // ignore malformed frame
          }
        };

        ws.onerror = () => {
          // ignore transient WebSocket connection errors
        };

        ws.onclose = () => {
          if (!unmounted) {
            reconnectTimer = setTimeout(connectWs, 1500);
          }
        };
      } catch {
        // fallback if WebSocket constructor fails in test environment
      }
    };

    connectWs();

    const handleOnlineReconnect = () => {
      if (!unmounted && (!ws || ws.readyState > 1)) {
        connectWs();
      }
    };
    window.addEventListener('online', handleOnlineReconnect);

    return () => {
      unmounted = true;
      window.removeEventListener('online', handleOnlineReconnect);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (ws) {
        try {
          if (ws.readyState === 0) {
            const pendingWs = ws;
            pendingWs.onopen = () => {
              try {
                pendingWs.close();
              } catch {
                // ignore
              }
            };
          } else if (ws.readyState === 1) {
            ws.close();
          }
        } catch {
          // ignore close errors
        }
      }
    };
  }, [incident?.id, incident?.status]);

  // Task 6: Location capture ONLY during an open or queued alert and ONLY if location consent is granted.
  // Clears latestLocation immediately when no alert is active or queued.
  useEffect(() => {
    if (!user) {
      return;
    }

    const hasActiveOrQueuedAlert =
      (incident && isOpenIncident(incident)) || queuedAlerts.length > 0;

    if (!hasActiveOrQueuedAlert) {
      setLocationStatus('idle');
      setLatestLocation(null);
      return;
    }

    if (!locationConsentGranted) {
      setLocationStatus('off');
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      typeof navigator.geolocation.getCurrentPosition !== 'function'
    ) {
      setLocationStatus('unavailable');
      return;
    }

    let cancelled = false;
    setLocationStatus('capturing');

    const captureSample = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          const capturedAt = new Date().toISOString();
          const samplePayload = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy ?? null,
            captured_at: capturedAt,
          };

          // Always keep the most recent fix in memory while alert is active/queued (GPS works offline)
          setLatestLocation({
            id: `local_loc_${Date.now()}`,
            incident_id: incident?.id || 'queued',
            expires_at: Date.now() + 600000,
            ...samplePayload,
          });
          setLocationStatus('active');

          if (incident && incident.id.startsWith('queued_')) {
            await updateQueuedAlertLocation(
              incident.client_request_id,
              samplePayload
            );
            return;
          }

          if (incident && !incident.id.startsWith('queued_')) {
            try {
              const res = await incidentsApi.addLocationSample(
                incident.id,
                samplePayload
              );
              if (!cancelled) {
                setLatestLocation(res.location);
              }
            } catch {
              // Keep local GPS fix for offline display / SMS fallback
            }
          }
        },
        () => {
          if (!cancelled) {
            setLocationStatus('unavailable');
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    };

    captureSample();
    const pollId = setInterval(captureSample, 15000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, [
    incident?.id,
    incident?.status,
    incident?.client_request_id,
    queuedAlerts.length,
    locationConsentGranted,
  ]);

  // Duress continuity: keep sending location samples silently after a duress-PIN cancel (with zero visible UI change)
  useEffect(() => {
    if (!silentDuressIncidentId || !locationConsentGranted) {
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      typeof navigator.geolocation.getCurrentPosition !== 'function'
    ) {
      return;
    }

    let cancelled = false;

    const sendSilentSample = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          try {
            await incidentsApi.addLocationSample(silentDuressIncidentId, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy ?? null,
              captured_at: new Date().toISOString(),
            });
          } catch (err) {
            if (
              err instanceof ApiError &&
              (err.status === 400 || err.status === 404)
            ) {
              setSilentDuressIncidentId(null);
            }
          }
        },
        () => {
          // ignore geolocation error silently
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    };

    sendSilentSample();
    const pollId = setInterval(sendSilentSample, 15000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, [silentDuressIncidentId, locationConsentGranted]);

  const handleCancelClick = async () => {
    if (!incident) return;

    // Guest mode cancellation
    if (incident.id.startsWith('guest_') || !user) {
      const guestPinHash = useTriggerSettingsStore.getState().guestCancelPinHash;
      if (guestPinHash) {
        setShowPinKeypad(true);
        setPinDigits('');
        setPinError(null);
        return;
      }
      setIncident({
        ...incident,
        status: 'CANCELLED',
        closed_at: new Date().toISOString(),
      });
      setShowPinKeypad(false);
      return;
    }

    // Task 4: Cancel while queued offline — remove alert from queue so it is never sent
    if (incident.id.startsWith('queued_') || queuedAlerts.length > 0) {
      setIsCancelling(true);
      try {
        await cancelQueuedAlert(incident.client_request_id);
        for (const q of queuedAlerts) {
          await cancelQueuedAlert(q.client_request_id);
        }
        setIncident({
          ...incident,
          status: 'CANCELLED',
          closed_at: new Date().toISOString(),
        });
        setShowPinKeypad(false);
      } finally {
        setIsCancelling(false);
      }
      return;
    }

    // If user profile indicates a cancel/duress PIN is configured, open the numeric keypad immediately
    if (user?.has_cancel_pin || user?.has_duress_pin) {
      setShowPinKeypad(true);
      setPinDigits('');
      setPinError(null);
      return;
    }

    setIsCancelling(true);
    setPinError(null);
    try {
      const res = await incidentsApi.cancelIncident(incident.id, {});
      setSilentDuressIncidentId(null);
      setIncident(res.incident);
      setShowPinKeypad(false);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        err.message.toLowerCase().includes('pin')
      ) {
        setShowPinKeypad(true);
        setPinDigits('');
        setPinError(null);
      } else {
        setServerError(t('sos.error.serverUnreachableBody'));
      }
    } finally {
      setIsCancelling(false);
    }
  };

  const handlePinSubmit = async () => {
    if (!incident) return;
    if (!pinDigits || pinDigits.length < 4) {
      setPinError(t('sos.cancelWindow.pinErrorRequired'));
      return;
    }

    if (incident.id.startsWith('guest_') || !user) {
      const isValid = await useTriggerSettingsStore
        .getState()
        .verifyGuestCancelPin(pinDigits);
      if (!isValid) {
        setPinError(t('sos.cancelWindow.pinErrorInvalid'));
        setPinDigits('');
        return;
      }
      setIncident({
        ...incident,
        status: 'CANCELLED',
        closed_at: new Date().toISOString(),
      });
      setShowPinKeypad(false);
      setPinDigits('');
      return;
    }

    if (incident.id.startsWith('queued_')) {
      await cancelQueuedAlert(incident.client_request_id);
      setIncident({
        ...incident,
        status: 'CANCELLED',
        closed_at: new Date().toISOString(),
      });
      setShowPinKeypad(false);
      setPinDigits('');
      return;
    }

    setIsCancelling(true);
    setPinError(null);
    try {
      const res = await incidentsApi.cancelIncident(incident.id, {
        pin: pinDigits,
      });
      setSilentDuressIncidentId(user?.has_duress_pin ? incident.id : null);
      setIncident(res.incident);
      setShowPinKeypad(false);
      setPinDigits('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setPinError(t('sos.cancelWindow.pinErrorInvalid'));
        setPinDigits('');
      } else {
        setServerError(t('sos.error.serverUnreachableBody'));
      }
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSelectEmergencyType = async (typeKey: string) => {
    if (!incident) return;
    setIncident((prev) =>
      prev ? { ...prev, emergency_type: typeKey } : prev
    );
    if (incident.id.startsWith('guest_')) {
      return;
    }
    if (incident.id.startsWith('queued_')) {
      await updateQueuedAlertEmergencyType(
        incident.client_request_id,
        typeKey
      );
      return;
    }
    try {
      const res = await incidentsApi.setEmergencyType(incident.id, typeKey);
      setIncident(res.incident);
    } catch {
      // Optional metadata; never block or interrupt the alert
    }
  };

  const handleMarkSafe = async () => {
    if (!incident) return;
    if (incident.id.startsWith('guest_') || !user) {
      setIncident({
        ...incident,
        status: 'RESOLVED',
        closed_at: new Date().toISOString(),
      });
      return;
    }

    if (incident.id.startsWith('queued_')) {
      await cancelQueuedAlert(incident.client_request_id);
      setIncident({
        ...incident,
        status: 'RESOLVED',
        closed_at: new Date().toISOString(),
      });
      return;
    }

    setIsResolving(true);
    setServerError(null);
    try {
      const res = await incidentsApi.resolveIncident(incident.id, {
        resolution: 'RESOLVED',
      });
      setIncident(res.incident);
    } catch {
      setServerError(t('sos.error.serverUnreachableBody'));
    } finally {
      setIsResolving(false);
    }
  };

  if (
    disguiseEnabled &&
    disguiseSequenceHash &&
    !disguiseUnlockedSession &&
    !incident &&
    queuedAlerts.length === 0
  ) {
    return (
      <DisguiseCalculator
        sequenceHash={disguiseSequenceHash}
        onUnlock={() => setDisguiseUnlockedSession(true)}
      />
    );
  }

  const isGuestMode = !user;
  const isGuestIncident = Boolean(incident?.id?.startsWith('guest_'));

  const onlineEligibleContacts: CachedEmergencyContact[] = contacts
    .filter((c) => c.status === 'accepted' && c.permissions.receives_sos)
    .sort((a, b) => a.priority_order - b.priority_order)
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone_e164: c.phone_e164,
      priority_order: c.priority_order,
    }));

  const eligibleSosContacts: CachedEmergencyContact[] =
    onlineEligibleContacts.length > 0 ? onlineEligibleContacts : cachedContacts;

  const activeQueuedEntry =
    queuedAlerts.find(
      (q) => q.client_request_id === incident?.client_request_id
    ) ||
    queuedAlerts[0] ||
    null;

  const needsReauthForQueue = queuedAlerts.some(
    (q) => q.status === 'needs_reauth'
  );

  const smsLocationSample = (locationConsentGranted && latestLocation)
    ? {
        lat: latestLocation.lat,
        lng: latestLocation.lng,
        accuracy_m: latestLocation.accuracy_m,
        captured_at: latestLocation.captured_at,
      }
    : (locationConsentGranted ? activeQueuedEntry?.location : null) || null;

  const smsBody = buildEmergencySmsBody({
    userName: user?.name || 'Guest',
    location: smsLocationSample,
    triggeredAtIso:
      incident?.created_at || activeQueuedEntry?.client_created_at,
  });

  const smsPlatform = detectSmsPlatform();
  const groupSmsHref = buildSmsFallbackHref(
    eligibleSosContacts.map((c) => c.phone_e164),
    smsBody,
    smsPlatform
  );

  const renderSmsFallbackPanel = () => {
    if (!isCurrentIncidentQueued && !serverError && !isGuestIncident) {
      return null;
    }

    return (
      <Card
        data-testid="sms-fallback-panel"
        className="border-2 border-amber-500 dark:border-amber-500 space-y-4 bg-amber-50/70 dark:bg-amber-950/40 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <WifiOff className="w-5 h-5 text-amber-800 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2
                data-testid="honest-queued-status-text"
                className="text-base font-bold text-amber-950 dark:text-amber-100"
              >
                {isGuestMode
                  ? t('guestSos.activeTitle')
                  : t('offline.queuedBannerText')}
              </h2>
              <p className="text-xs text-amber-900 dark:text-amber-200">
                {isGuestMode
                  ? t('guestSos.smsNote')
                  : t('offline.smsFallbackHonestNote')}
              </p>
            </div>
          </div>
          {!isGuestMode && (
            <Button
              type="button"
              variant="outline"
              data-testid="flush-queue-now-btn"
              onClick={() => void flushOfflineAlertQueue()}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              {t('sos.error.retryBtn')}
            </Button>
          )}
        </div>

        {/* Note if guest mode */}
        {isGuestMode && (
          <div className="space-y-3">
            <div
              data-testid="guest-plain-sms-note"
              className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-amber-300 dark:border-amber-700 text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              {t('guestSos.smsNote')}
            </div>

            {/* Guest Location Tap Action: only requested on user tap */}
            {latestLocation ? (
              <div
                data-testid="guest-location-included-badge"
                className="p-3 bg-teal-50 dark:bg-teal-950/40 rounded-xl border border-teal-300 dark:border-teal-700 text-xs font-semibold text-teal-900 dark:text-teal-200 flex items-center justify-between"
              >
                <span>{t('guestSos.locationIncluded')}</span>
                <span className="font-mono">
                  {latestLocation.lat.toFixed(4)}, {latestLocation.lng.toFixed(4)}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5" data-testid="guest-location-action-area">
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="guest-include-location-btn"
                  isLoading={isCapturingGuestLocation}
                  onClick={handleGuestIncludeLocation}
                  className="w-full min-h-[48px] justify-center"
                >
                  <MapPin className="w-4 h-4 mr-2 text-teal-700 dark:text-teal-400" />
                  {t('guestSos.includeLocationBtn')}
                </Button>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {t('guestSos.locationConsentTapNote')}
                </p>
                {guestLocationError && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {guestLocationError}
                  </p>
                )}
              </div>
            )}

            {/* Loud Siren Trigger for Guest in Distress without signing in */}
            <Button
              type="button"
              variant="outline"
              data-testid="guest-loud-siren-btn"
              onClick={handleLoudAlarmClick}
              className="w-full min-h-[48px] justify-center border-amber-500/70 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            >
              <Bell className="w-4 h-4 mr-2 text-amber-600 dark:text-amber-400" />
              {t('guestSos.sirenBtn')}
            </Button>
          </div>
        )}

        {/* Task 5: Auth while offline -> if 401 refresh failed, tell user to sign in and never drop alert */}
        {needsReauthForQueue && (
          <div
            role="alert"
            data-testid="queued-reauth-banner"
            className="rounded-xl border border-rose-500 bg-rose-100 dark:bg-rose-950 p-3.5 space-y-2"
          >
            <p className="text-sm font-bold text-rose-950 dark:text-rose-100">
              {t('offline.reauthRequiredTitle')}
            </p>
            <p className="text-xs text-rose-900 dark:text-rose-200">
              {t('offline.reauthRequiredBody')}
            </p>
            <Button
              type="button"
              variant="primary"
              data-testid="queued-reauth-signin-btn"
              onClick={() => navigate('/login')}
            >
              {t('offline.signInToDeliverBtn')}
            </Button>
          </div>
        )}

        {/* Task 7: One-tap Send by SMS button + per-contact SMS buttons */}
        <div className="space-y-2.5">
          <a
            href={groupSmsHref}
            data-testid="sms-fallback-group-link"
            onClick={() => setSmsComposerOpened(true)}
            className="min-h-[56px] w-full px-5 py-3.5 rounded-2xl font-bold text-base bg-amber-800 text-white hover:bg-amber-900 inline-flex items-center justify-center gap-2.5 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/50"
          >
            <MessageSquare className="w-5 h-5" />
            <span>{t('offline.sendBySmsGroupBtn')}</span>
          </a>

          {eligibleSosContacts.length > 0 && (
            <div
              data-testid="sms-per-contact-list"
              className="grid grid-cols-1 gap-2 pt-1"
            >
              {eligibleSosContacts.map((contact) => {
                const singleHref = buildSmsFallbackHref(
                  [contact.phone_e164],
                  smsBody,
                  smsPlatform
                );
                return (
                  <a
                    key={contact.id}
                    href={singleHref}
                    data-testid={`sms-contact-link-${contact.id}`}
                    onClick={() => setSmsComposerOpened(true)}
                    className="min-h-[56px] px-4 py-2.5 rounded-xl font-semibold text-sm bg-white dark:bg-slate-900 border border-amber-400 dark:border-amber-700 text-slate-900 dark:text-slate-100 hover:bg-amber-100/60 inline-flex items-center justify-between gap-2"
                  >
                    <span className="inline-flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-amber-800 dark:text-amber-300" />
                      <span>
                        {t('offline.sendBySmsSingleBtn', {
                          name: contact.name,
                          phone: contact.phone_e164,
                        })}
                      </span>
                    </span>
                    <span className="text-xs font-mono text-amber-800 dark:text-amber-300">
                      #{contact.priority_order}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Never claim SMS was sent automatically; ask user to confirm after returning */}
        {smsComposerOpened && !smsConfirmedAt && (
          <div
            data-testid="sms-confirm-prompt"
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('offline.smsConfirmPrompt')}
            </p>
            <Button
              type="button"
              variant="secondary"
              data-testid="sms-confirm-sent-btn"
              onClick={() =>
                setSmsConfirmedAt(
                  new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                )
              }
            >
              {t('offline.smsConfirmBtn')}
            </Button>
          </div>
        )}

        {smsConfirmedAt && (
          <p
            data-testid="sms-confirmed-badge"
            className="text-xs font-semibold text-teal-800 dark:text-teal-300 flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {t('offline.smsConfirmedBadge', { time: smsConfirmedAt })}
            </span>
          </p>
        )}

        {/* Task 9: Include Call 112 / Call 181 directly on the queued/offline screen */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-amber-200 dark:border-amber-800/60">
          <a
            href="tel:112"
            data-testid="offline-call-112-btn"
            className="min-h-[56px] px-5 py-3 rounded-2xl font-semibold text-sm bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-2"
          >
            <PhoneCall className="w-4 h-4" />
            {t('sos.live.call112Btn')}
          </a>
          <a
            href="tel:181"
            data-testid="offline-call-181-btn"
            className="min-h-[56px] px-5 py-3 rounded-2xl font-semibold text-sm border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 inline-flex items-center justify-center gap-2"
          >
            <PhoneCall className="w-4 h-4" />
            {t('sos.live.call181Btn')}
          </a>
        </div>
      </Card>
    );
  };

  const renderEmergencyTypeChips = () => {
    if (!incident) return null;
    return (
      <Card className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('sos.emergencyType.title')}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t('sos.emergencyType.subtitle')}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {EMERGENCY_TYPES.map((typeKey) => {
            const isSelected = incident.emergency_type === typeKey;
            return (
              <button
                key={typeKey}
                type="button"
                aria-pressed={isSelected}
                onClick={() => void handleSelectEmergencyType(typeKey)}
                className={`min-h-[56px] px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                  isSelected
                    ? 'bg-teal-700 text-white border-teal-700 dark:bg-teal-600 dark:border-teal-500'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {t(`sos.emergencyType.${typeKey}`)}
              </button>
            );
          })}
        </div>
      </Card>
    );
  };

  const renderSharingPreviewAndLocation = () => {
    if (!incident) return null;
    const autoExpireMinutes = incident.auto_expire_minutes ?? 60;
    return (
      <Card className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('sos.sharingPreview.title')}
          </h2>
          <span
            data-testid="sharing-auto-stop"
            className="text-xs text-slate-600 dark:text-slate-300"
          >
            {t('sos.sharingPreview.autoStop', { minutes: autoExpireMinutes })}
          </span>
        </div>

        {/* Who will be alerted */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('sos.sharingPreview.whoLabel')}
          </p>
          {eligibleSosContacts.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-800 dark:text-slate-200">
              {eligibleSosContacts.map((contact, idx) => (
                <li key={contact.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-teal-700 dark:text-teal-400">
                    #{idx + 1}
                  </span>
                  <span className="font-medium">{contact.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {t('sos.sharingPreview.noContacts')}
            </p>
          )}
        </div>

        {/* Task 6: Location status during alert ("Last known at HH:MM") */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <MapPin className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <span>{t('sos.location.title')}</span>
          </div>

          {!locationConsentGranted || locationStatus === 'off' ? (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {t('sos.sharingPreview.locationOff')}
            </p>
          ) : locationStatus === 'unavailable' && !latestLocation ? (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {t('sos.location.unavailable')}
            </p>
          ) : latestLocation ? (
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5 font-mono tabular-nums">
              {latestLocation.accuracy_m !== null && (
                <p>
                  {t('sos.location.accuracy', {
                    meters: Math.round(latestLocation.accuracy_m),
                  })}
                </p>
              )}
              <p data-testid="last-known-location-time">
                {t('offline.lastKnownLocationAt', {
                  time: new Date(
                    latestLocation.captured_at
                  ).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('sos.location.capturing')}
            </p>
          )}
        </div>
      </Card>
    );
  };

  // Circle SVG geometry for 2-second hold progress ring
  const radius = 96;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (holdProgress / 100) * circumference;

  return (
    <PageLayout>
      <div className="max-w-xl mx-auto space-y-6 py-2">
        {/* Screen-reader live region for hold-to-trigger announcements */}
        <div
          role="status"
          aria-live="assertive"
          aria-atomic="true"
          className="sr-only"
          data-testid="sos-sr-announcer"
        >
          {srAnnouncement}
        </div>

        {/* Task 9: Honest Sent Timestamp Banner (only shown when actually delivered to server) */}
        {incident &&
          !incident.id.startsWith('queued_') &&
          isOpenIncident(incident) &&
          sentAtTime && (
            <div
              role="status"
              data-testid="honest-sent-at-banner"
              className="rounded-xl border border-teal-600/40 bg-teal-50/80 dark:bg-teal-950/50 px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-teal-900 dark:text-teal-200"
            >
              <span>{t('offline.sentAtBannerText', { time: sentAtTime })}</span>
              <span className="font-mono">{incident.source_trigger}</span>
            </div>
          )}

        {/* SMS Fallback & Honest Queued Status Panel */}
        {renderSmsFallbackPanel()}

        {/* Honest Server Error / Retry Banner */}
        {serverError && !isCurrentIncidentQueued && (
          <div
            role="alert"
            className="rounded-2xl border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/60 p-5 space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-base font-bold text-rose-900 dark:text-rose-100">
                  {t('sos.error.serverUnreachableTitle')}
                </h2>
                <p className="text-sm text-rose-800 dark:text-rose-200">
                  {serverError}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BigButton
                variant="primary"
                onClick={() => {
                  if (failedAction === 'trigger') {
                    void executeTrigger('button');
                  } else {
                    void loadSafetyOverview();
                  }
                }}
              >
                <RefreshCw className="w-5 h-5" />
                {t('sos.error.retryBtn')}
              </BigButton>
              <a
                href="tel:112"
                className="min-h-[56px] px-6 py-3.5 rounded-2xl font-semibold text-base bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/50"
              >
                <PhoneCall className="w-5 h-5" />
                {t('sos.live.call112Btn')}
              </a>
            </div>
          </div>
        )}

        {/* Initial Loading State */}
        {isInitialLoading && !incident && (
          <div className="flex items-center justify-center gap-3 py-4 text-sm text-slate-600 dark:text-slate-400">
            <Spinner className="w-5 h-5" />
            <span>{t('sos.loading')}</span>
          </div>
        )}

        {/* Zero-Contacts Warning Banner (never blocks the SOS button) */}
        {!isInitialLoading && notifiableCount === 0 && (
          <div
            role="region"
            aria-label="Trusted contact warning"
            data-testid="zero-contacts-banner"
            className="rounded-2xl border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                {t('sos.zeroContactsBanner')}
              </p>
            </div>
            <Link
              to="/circle"
              className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold bg-amber-900 text-white hover:bg-amber-950 dark:bg-amber-400 dark:text-slate-950 inline-flex items-center justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              {t('sos.zeroContactsCta')}
            </Link>
          </div>
        )}

        {/* SCREEN 1: CANCEL WINDOW (status === 'TRIGGERED') */}
        {incident && incident.status === 'TRIGGERED' && (
          <section
            aria-label="Cancel window"
            data-testid="cancel-window-screen"
            className="space-y-6"
          >
            <Card className="border border-rose-200 dark:border-rose-900/50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl space-y-5 text-center shadow-xl p-6">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                  {t('sos.cancelWindow.kicker')}
                </p>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {incident.id.startsWith('queued_')
                    ? t('offline.queuedBannerText')
                    : t('sos.cancelWindow.title')}
                </h1>
                <p
                  data-testid="cancel-countdown"
                  className="text-4xl font-extrabold font-mono tabular-nums text-rose-700 dark:text-rose-400 py-1"
                >
                  {t('sos.cancelWindow.countdown', {
                    seconds: cancelSecondsLeft,
                  })}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">
                  {t('sos.cancelWindow.subtitle')}
                </p>
              </div>

              {!showPinKeypad ? (
                <BigButton
                  variant="secondary"
                  data-testid="cancel-alert-btn"
                  isLoading={isCancelling}
                  onClick={() => void handleCancelClick()}
                >
                  {t('sos.cancelWindow.cancelBtn')}
                </BigButton>
              ) : (
                <div
                  data-testid="pin-keypad"
                  className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-left"
                >
                  <div className="text-center space-y-1">
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {t('sos.cancelWindow.pinTitle')}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {t('sos.cancelWindow.pinSubtitle')}
                    </p>
                  </div>

                  {/* Masked PIN Display (No system keyboard input) */}
                  <div
                    aria-label="Entered PIN digits"
                    data-testid="pin-display"
                    className="min-h-[56px] rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-2xl font-mono tracking-widest text-slate-900 dark:text-slate-100 shadow-inner"
                  >
                    {pinDigits.length > 0
                      ? '●'.repeat(pinDigits.length)
                      : '—'}
                  </div>

                  {pinError && (
                    <p
                      role="alert"
                      data-testid="pin-error"
                      className="text-sm font-semibold text-center text-rose-700 dark:text-rose-400"
                    >
                      {pinError}
                    </p>
                  )}

                  {/* Large Numeric Keypad Grid (56px targets) */}
                  <div className="grid grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(
                      (digit) => (
                        <button
                          key={digit}
                          type="button"
                          aria-label={`Digit ${digit}`}
                          onClick={() => {
                            if (pinDigits.length < 8) {
                              setPinDigits((prev) => prev + digit);
                              setPinError(null);
                            }
                          }}
                          className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-xl font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors shadow-xs"
                        >
                          {digit}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setPinDigits('');
                        setPinError(null);
                      }}
                      className="min-h-[56px] rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
                    >
                      {t('sos.cancelWindow.pinClear')}
                    </button>
                    <button
                      type="button"
                      aria-label="Digit 0"
                      onClick={() => {
                        if (pinDigits.length < 8) {
                          setPinDigits((prev) => prev + '0');
                          setPinError(null);
                        }
                      }}
                      className="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-xl font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors shadow-xs"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      aria-label={t('sos.cancelWindow.pinBackspace')}
                      onClick={() => {
                        setPinDigits((prev) => prev.slice(0, -1));
                        setPinError(null);
                      }}
                      className="min-h-[56px] rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 inline-flex items-center justify-center text-slate-700 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
                    >
                      <Delete className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                    <BigButton
                      variant="primary"
                      data-testid="pin-submit-btn"
                      isLoading={isCancelling}
                      onClick={() => void handlePinSubmit()}
                    >
                      {t('sos.cancelWindow.pinSubmit')}
                    </BigButton>
                    <BigButton
                      variant="outline"
                      onClick={() => {
                        setShowPinKeypad(false);
                        setPinDigits('');
                        setPinError(null);
                      }}
                    >
                      {t('sos.cancelWindow.pinBack')}
                    </BigButton>
                  </div>
                </div>
              )}
            </Card>

            {renderEmergencyTypeChips()}
            {renderSharingPreviewAndLocation()}
          </section>
        )}

        {/* SCREEN 2: LIVE STATUS SCREEN (ACTIVE / NOTIFIED / ACKNOWLEDGED / RESPONDING / ESCALATED) */}
        {incident &&
          (incident.status === 'ACTIVE' ||
            incident.status === 'NOTIFIED' ||
            incident.status === 'ACKNOWLEDGED' ||
            incident.status === 'RESPONDING' ||
            incident.status === 'ESCALATED') && (
            <section
              aria-label="Live alert status"
              data-testid="live-status-screen"
              className="space-y-6"
            >
              {isGuestIncident ? (
                <>
                  <div
                    data-testid="guest-active-alert-banner"
                    className="w-full bg-rose-700/95 dark:bg-rose-900/95 backdrop-blur-md border border-rose-800 dark:border-rose-700/60 p-4 rounded-2xl flex items-center justify-between text-white shadow-xl"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                      <div>
                        <h1
                          data-testid="live-status-heading"
                          className="text-lg font-bold text-white tracking-tight"
                        >
                          {t('guestSos.activeTitle')}
                        </h1>
                        <p className="text-xs text-white/90">
                          {t('guestSos.activeSubtitle')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {renderSmsFallbackPanel()}

                  <div className="space-y-2.5 pt-2">
                    <Button
                      variant="outline"
                      data-testid="im-safe-btn"
                      isLoading={isResolving}
                      fullWidth
                      onClick={() => void handleMarkSafe()}
                      className="border-2 border-teal-700 text-teal-700 hover:bg-teal-700/10 min-h-[48px]"
                    >
                      <CheckCircle2 className="w-4 h-4 text-teal-700 mr-2" />
                      {t('guestSos.resolveAlert')}
                    </Button>
                  </div>

                  {renderEmergencyTypeChips()}
                  {renderSharingPreviewAndLocation()}
                </>
              ) : (
                <>
                  {/* Prominent Call 112 Now Prompt when needs_user_action is true */}
                  {incident.needs_user_action && (
                    <div
                      role="alert"
                      data-testid="needs-user-action-banner"
                      className="rounded-2xl border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/70 p-5 space-y-4"
                    >
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="w-6 h-6 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h2 className="text-lg font-bold text-rose-950 dark:text-rose-100">
                            {t('sos.live.needsActionTitle')}
                          </h2>
                          <p className="text-sm text-rose-900 dark:text-rose-200">
                            {t('sos.live.needsActionBody')}
                          </p>
                        </div>
                      </div>
                      <a
                        href="tel:112"
                        data-testid="call-112-now-btn"
                        className="min-h-[56px] w-full px-6 py-3.5 rounded-2xl font-bold text-base bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-3 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/50"
                      >
                        <PhoneCall className="w-5 h-5" />
                        {t('sos.live.call112NowBtn')}
                      </a>
                    </div>
                  )}

                  {/* Live Status Header Banner */}
                  <div className="w-full bg-rose-700/95 dark:bg-rose-900/95 backdrop-blur-md border border-rose-800 dark:border-rose-700/60 p-4 rounded-2xl flex items-center justify-between text-white shadow-xl">
                    <div className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                      <div>
                        <h1
                          data-testid="live-status-heading"
                          className="text-lg font-bold text-white tracking-tight"
                        >
                          {incident.status === 'RESPONDING'
                            ? t('sos.live.statusRespondingTitle')
                            : incident.status === 'ACKNOWLEDGED'
                            ? t('sos.live.statusAcknowledgedTitle')
                            : incident.status === 'ESCALATED'
                            ? t('sos.live.statusEscalatedTitle')
                            : incident.status === 'NOTIFIED'
                            ? t('sos.live.statusNotifiedTitle')
                            : t('sos.live.statusActiveTitle')}
                        </h1>
                        <p className="text-xs text-white/90">
                          {incident.status === 'RESPONDING'
                            ? t('sos.live.statusRespondingBody')
                            : incident.status === 'ACKNOWLEDGED'
                            ? t('sos.live.statusAcknowledgedBody')
                            : incident.status === 'ESCALATED'
                            ? t('sos.live.statusEscalatedBody')
                            : incident.status === 'NOTIFIED'
                            ? t('sos.live.statusNotifiedBody')
                            : t('sos.live.statusActiveBody')}
                        </p>
                      </div>
                    </div>
                    <span
                      data-testid="contacts-notified-badge"
                      className="px-2.5 py-1 bg-white text-rose-800 text-xs font-bold uppercase tracking-widest rounded-lg tabular-nums shadow-xs"
                    >
                      {t('sos.live.statusNotifiedTitle')}
                    </span>
                  </div>

                  {/* Status Ladder (Confirmed Operational Steps) */}
                  <Card className="border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl p-5 shadow-xl space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                        {t('sos.live.statusLadderTitle', { defaultValue: 'Status Ladder' })}
                      </h2>
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {t('sos.live.confirmedSteps', { defaultValue: 'Confirmed Steps' })}
                      </span>
                    </div>

                    <ol className="relative space-y-3 pl-5 border-l-2 border-teal-700 ml-2">
                      <li className="relative">
                        <div aria-hidden="true" className="absolute -left-[27px] top-1.5 w-3 h-3 bg-teal-700 border-2 border-white dark:border-slate-900 rounded-full" />
                        <div className="flex flex-col">
                          <div className="flex items-baseline justify-between">
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {t('sos.live.stepSaved', { defaultValue: 'Saved on this phone' })}
                            </span>
                            <span className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                              {sentAtTime || 'Confirmed'}
                            </span>
                          </div>
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            {t('sos.live.stepSavedSub', { defaultValue: 'Local encrypted emergency record confirmed' })}
                          </span>
                        </div>
                      </li>

                      <li className="relative">
                        <div
                          aria-hidden="true"
                          className="absolute -left-[27px] top-1.5 w-3 h-3 border-2 border-white dark:border-slate-900 bg-teal-700 rounded-full"
                        />
                        <div className="flex flex-col">
                          <div className="flex items-baseline justify-between">
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {t('sos.live.stepSent', { defaultValue: 'Sent to circle & responders' })}
                            </span>
                            <span className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                              Relayed
                            </span>
                          </div>
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            {t('sos.live.stepSentSub', { defaultValue: 'Broadcast via SMS and cellular data relays' })}
                          </span>
                        </div>
                      </li>

                      <li className="relative">
                        <div
                          aria-hidden="true"
                          className={`absolute -left-[27px] top-1.5 w-3 h-3 border-2 border-white dark:border-slate-900 rounded-full ${
                            incident.status === 'NOTIFIED' ||
                            incident.status === 'ACKNOWLEDGED' ||
                            incident.status === 'RESPONDING' ||
                            incident.status === 'ESCALATED'
                              ? 'bg-teal-700'
                              : 'bg-slate-200 dark:bg-slate-700 border-slate-400'
                          }`}
                        />
                        <div className="flex flex-col">
                          <div className="flex items-baseline justify-between">
                            <span
                              className={`text-sm ${
                                incident.status === 'NOTIFIED' ||
                                incident.status === 'ACKNOWLEDGED' ||
                                incident.status === 'RESPONDING' ||
                                incident.status === 'ESCALATED'
                                  ? 'font-bold text-slate-900 dark:text-slate-100'
                                  : 'font-normal text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {t('sos.live.stepDelivered', { defaultValue: 'Delivered to emergency circle' })}
                            </span>
                            <span className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                              {eligibleSosContacts.length} contacts
                            </span>
                          </div>
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            {t('sos.live.stepDeliveredSub', { defaultValue: 'SMS alerts delivered with live link' })}
                          </span>
                        </div>
                      </li>

                      <li className="relative">
                        <div
                          aria-hidden="true"
                          className={`absolute -left-[27px] top-1.5 w-3 h-3 border-2 border-white dark:border-slate-900 rounded-full ${
                            incident.status === 'ACKNOWLEDGED' || incident.status === 'RESPONDING'
                              ? 'bg-teal-700'
                              : 'bg-slate-200 dark:bg-slate-700 border-slate-400'
                          }`}
                        />
                        <div className="flex flex-col">
                          <div className="flex items-baseline justify-between">
                            <span
                              className={`text-sm ${
                                incident.status === 'ACKNOWLEDGED' || incident.status === 'RESPONDING'
                                  ? 'font-bold text-slate-900 dark:text-slate-100'
                                  : 'font-normal text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {t('sos.live.stepAck', { defaultValue: 'Acknowledged' })}
                            </span>
                            <span className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                              {incident.status === 'ACKNOWLEDGED' || incident.status === 'RESPONDING'
                                ? 'Seen'
                                : 'Awaiting'}
                            </span>
                          </div>
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            {incident.status === 'ACKNOWLEDGED' || incident.status === 'RESPONDING'
                              ? t('sos.live.statusAcknowledgedTitle')
                              : t('sos.live.stepAckSub', { defaultValue: 'Awaiting first contact or responder open' })}
                          </span>
                        </div>
                      </li>
                    </ol>

                    {/* Primary Safety Actions: I'm safe + Call 112 / Call 181 */}
                    <div className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <a
                          href="tel:112"
                          className="min-h-[48px] px-5 py-2.5 rounded-xl font-bold text-sm bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
                        >
                          <PhoneCall className="w-4 h-4" />
                          {t('sos.live.call112Btn')}
                        </a>
                        <a
                          href="tel:181"
                          className="min-h-[48px] px-5 py-2.5 rounded-xl font-bold text-sm bg-teal-700 text-white hover:bg-teal-800 inline-flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
                        >
                          <PhoneCall className="w-4 h-4" />
                          {t('sos.live.call181Btn')}
                        </a>
                      </div>

                      <Button
                        variant="outline"
                        data-testid="im-safe-btn"
                        isLoading={isResolving}
                        fullWidth
                        onClick={() => void handleMarkSafe()}
                        className="border-2 border-teal-700 text-teal-700 hover:bg-teal-700/10 min-h-[48px]"
                      >
                        <CheckCircle2 className="w-4 h-4 text-teal-700" />
                        {t('sos.live.imSafeBtn')}
                      </Button>
                    </div>
                  </Card>

                  {renderEmergencyTypeChips()}
                  {renderSharingPreviewAndLocation()}
                </>
              )}
            </section>
          )}

        {/* SCREEN 3: CLOSED OUTCOME (CANCELLED / RESOLVED / FALSE_ALARM / EXPIRED) */}
        {incident &&
          (incident.status === 'CANCELLED' ||
            incident.status === 'RESOLVED' ||
            incident.status === 'FALSE_ALARM' ||
            incident.status === 'EXPIRED') && (
            <section
              aria-label="Alert closed status"
              data-testid="closed-status-screen"
              className="space-y-6"
            >
              <Card className="space-y-4 text-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-xl rounded-2xl p-6">
                <CheckCircle2 className="w-10 h-10 text-teal-700 dark:text-teal-400 mx-auto" />
                <div className="space-y-1">
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
                    {incident.status === 'CANCELLED'
                      ? t('sos.live.statusCancelledTitle')
                      : incident.status === 'EXPIRED'
                      ? t('sos.live.statusExpiredTitle')
                      : t('sos.live.statusResolvedTitle')}
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {incident.status === 'CANCELLED'
                      ? t('sos.live.statusCancelledBody')
                      : incident.status === 'EXPIRED'
                      ? t('sos.live.statusExpiredBody', {
                          minutes: incident.auto_expire_minutes ?? 60,
                        })
                      : t('sos.live.statusResolvedBody')}
                  </p>
                </div>
                <BigButton
                  variant="primary"
                  data-testid="return-home-btn"
                  onClick={() => {
                    setIncident(null);
                    setLatestLocation(null);
                    setLocationStatus('idle');
                    setSentAtTime(null);
                  }}
                >
                  {t('sos.live.backToReadyBtn')}
                </BigButton>
              </Card>

              {/* Phase 10B: Small calm support options card on every closed-alert screen */}
              <ClosedAlertSupportCard />

              {/* Post-incident rating card: only shown after incident closes (normal or masked duress) */}
              <PostIncidentRatingCard incidentId={incident.id} />
            </section>
          )}

        {/* SCREEN 0: IDLE HOME / HUGE HOLD-TO-TRIGGER SOS BUTTON */}
        {!incident && (
          <section
            aria-label="Emergency SOS trigger"
            className="space-y-8 text-center py-2"
          >
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {user ? t('home.welcomeBack', { name: user.name }) : 'SAATHI Emergency SOS'}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('sos.buttonInstruction')}
              </p>
            </div>

            {/* Offer to migrate local device contacts after sign-in */}
            {user && (
              <SignInLaterOfferCard
                cachedContacts={cachedContacts}
                onlineContacts={contacts}
                onMigrated={loadSafetyOverview}
              />
            )}

            {disguiseEnabled && disguiseUnlockedSession && (
              <div className="flex justify-center">
                <button
                  type="button"
                  data-testid="relock-disguise-btn"
                  onClick={() => setDisguiseUnlockedSession(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Lock to Calculator Disguise
                </button>
              </div>
            )}

            {/* Paper Utility 72px Horizontal Hold-to-Trigger Button with Linear Progress Fill */}
            <div className="relative w-full max-w-lg mx-auto">
              <span
                data-testid="sos-progress-ring"
                className="sr-only"
                aria-hidden="true"
                style={{ strokeDashoffset }}
              >
                {holdProgress}%
              </span>

              <button
                type="button"
                data-testid="sos-hold-button"
                aria-label={`${t('sos.buttonLabel')} — ${t('sos.buttonInstruction')}`}
                disabled={isSubmittingSos}
                onMouseDown={startHold}
                onMouseUp={cancelHoldEarly}
                onMouseLeave={cancelHoldEarly}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startHold();
                }}
                onTouchEnd={cancelHoldEarly}
                onTouchCancel={cancelHoldEarly}
                onKeyDown={(e) => {
                  if (
                    (e.key === ' ' || e.key === 'Enter') &&
                    !e.repeat
                  ) {
                    e.preventDefault();
                    startHold();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    cancelHoldEarly();
                  }
                }}
                className="relative w-full min-h-[72px] h-[72px] bg-crimson-800 text-surface rounded-2xl border border-crimson-900 select-none overflow-hidden flex flex-col items-center justify-center cursor-pointer active:bg-crimson-900 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-transform active:scale-[0.99]"
              >
                <div
                  className="absolute left-0 top-0 bottom-0 bg-crimson-900 transition-none pointer-events-none"
                  style={{ width: `${holdProgress}%` }}
                />
                <div className="relative z-10 flex flex-col items-center justify-center text-center px-4">
                  <span className="text-xl font-bold tracking-wide uppercase text-surface">
                    {t('sos.buttonLabel')}
                  </span>
                  <span className="text-xs text-surface/90 font-mono tabular-nums">
                    {isHolding
                      ? t('sos.holdingProgress', { percent: holdProgress })
                      : '2s hold'}
                  </span>
                </div>
              </button>
            </div>

            {/* Quick Utility Row: 3 Quiet Utility Buttons (48px targets) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-w-lg mx-auto pt-2">
              <button
                type="button"
                data-testid="home-fake-call-btn"
                onClick={handleFakeCallClick}
                className="min-h-[48px] px-3 py-2.5 rounded-xl font-semibold text-sm bg-surface hover:bg-surface-container border border-line text-ink dark:bg-night-surface dark:border-night-line dark:text-night-text dark:hover:bg-night flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Phone className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                <span className="truncate">{t('fakeCall.homeBtn')}</span>
              </button>
              <button
                type="button"
                data-testid="home-loud-alarm-btn"
                onClick={handleLoudAlarmClick}
                className="min-h-[48px] px-3 py-2.5 rounded-xl font-semibold text-sm bg-surface hover:bg-surface-container border border-line text-ink dark:bg-night-surface dark:border-night-line dark:text-night-text dark:hover:bg-night flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Bell className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                <span className="truncate">{t('loudAlarm.homeBtn')}</span>
              </button>
              <Link
                to="/journeys"
                className="min-h-[48px] px-3 py-2.5 rounded-xl font-semibold text-sm bg-surface hover:bg-surface-container border border-line text-ink dark:bg-night-surface dark:border-night-line dark:text-night-text dark:hover:bg-night flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <MapPin className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                <span className="truncate">{t('journeys.navLink')}</span>
              </Link>
            </div>

            {/* Direct Helpline Call Links (48px targets) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg mx-auto pt-2">
              <a
                href="tel:112"
                className="min-h-[48px] px-5 py-2.5 rounded-xl font-semibold text-sm bg-ink text-surface hover:bg-slate-800 border border-ink dark:bg-night-surface dark:border-night-line dark:text-night-text inline-flex items-center justify-center gap-2 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                {t('sos.secondary.call112')}
              </a>
              <a
                href="tel:181"
                className="min-h-[48px] px-5 py-2.5 rounded-xl font-semibold text-sm bg-surface border border-line text-ink hover:bg-surface-container dark:bg-night-surface dark:border-night-line dark:text-night-text inline-flex items-center justify-center gap-2 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                {t('sos.secondary.call181')}
              </a>
            </div>

            {/* Guest Contacts Management: Only when not signed in */}
            {!user && (
              <div className="max-w-lg mx-auto pt-2">
                <GuestContactsCard
                  contacts={guestContacts}
                  onContactsUpdated={async () => {
                    const guest = await getGuestEmergencyContacts();
                    setGuestContacts(guest);
                    setNotifiableCount(guest.length);
                  }}
                />
              </div>
            )}

            {/* Small Calm Secondary Links Below (Circle, Consents/Resources, Guide) */}
            <nav
              aria-label="Secondary safety links"
              className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-center gap-4 text-sm font-medium text-slate-600 dark:text-slate-300"
            >
              <Link
                to="/journeys"
                data-testid="home-journeys-link"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 hover:text-teal-700 dark:hover:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
              >
                {t('journeys.navLink')}
              </Link>
              <Link
                to="/reports"
                data-testid="home-reports-link"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 hover:text-teal-700 dark:hover:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
              >
                {t('reports.navLink')}
              </Link>
              <Link
                to="/resources"
                data-testid="home-resources-link"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 hover:text-teal-700 dark:hover:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
              >
                {t('resources.navLink')}
              </Link>
              <Link
                to="/circle"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 hover:text-teal-700 dark:hover:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
              >
                <Users className="w-4 h-4" />
                {t('sos.secondary.circleLink', { count: notifiableCount })}
              </Link>
              <Link
                to="/consents"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 hover:text-teal-700 dark:hover:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
              >
                <ShieldCheck className="w-4 h-4" />
                {t('sos.secondary.resourcesLink')}
              </Link>
              <Link
                to="/onboarding"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 hover:text-teal-700 dark:hover:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
              >
                {t('sos.secondary.guideLink')}
              </Link>
              {!user && (
                <Link
                  to="/login"
                  data-testid="home-signin-link"
                  className="min-h-[44px] px-3 inline-flex items-center gap-1.5 font-bold text-teal-700 dark:text-teal-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg"
                >
                  {t('accountRequired.signInCta')}
                </Link>
              )}
            </nav>

            {/* Small dismissible weekly Safety Pulse card (never covering SOS, never shown during an active/queued alert or in disguise mode) */}
            <SafetyPulseCard
              hasActiveAlert={
                Boolean(incident && isOpenIncident((incident as any).status)) ||
                queuedAlerts.length > 0
              }
              isDisguised={Boolean(disguiseEnabled)}
            />

            <DemoSimulatePanel
              incidentId={(incident as any)?.id}
              onSimulated={() => void loadSafetyOverview()}
            />
          </section>
        )}
      </div>

      {/* Phase 10A Safety Tools Modals */}
      <FakeCallModal
        isOpen={showFakeCall}
        onClose={() => setShowFakeCall(false)}
        audioContext={fakeCallAudioCtx}
      />
      <LoudAlarmModal
        isOpen={showLoudAlarm}
        onClose={() => setShowLoudAlarm(false)}
      />
    </PageLayout>
  );
};
