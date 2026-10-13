# Phase 08A Report — Impact Metrics & Post-Incident Ratings (Backend Only)

## 1. What Was Built

1. **Migration & Schema (`apps/api/src/db/migrations/0011_post_incident_ratings.sql`, `apps/api/src/db/schema.ts`, `apps/api/src/core/db.ts`)**:
   - Added `post_incident_ratings` table (`incident_id` PK, `score` integer 1–5, `created_at` text; **no `user_id` stored**).
   - Added `client_created_at` (`text`) and `queued_offline` (`integer` boolean default `0`) to `incidents` so online vs. offline-queued alert-initiation latencies are persisted and separated accurately.
   - Wired `queued_offline: true` in `apps/web/src/lib/offlineQueue.ts` when flushing queued offline alerts.

2. **Post-Incident Rating Endpoint (`POST /api/incidents/:id/rating`)**:
   - Owner-only (`403` for non-owners), validated 1–5 integer score (`422` otherwise), once per incident (`409` on duplicate).
   - Allowed only after the incident closes (`RESOLVED`, `FALSE_ALARM`, `CANCELLED`, `AUTO_EXPIRED`), **except** for duress incidents (`is_duress = true`), where the owner's masked view treats the incident as closed—allowing the rating to succeed without mutating the underlying duress incident state or timestamps.

3. **Impact Metrics Service & Admin Endpoints (`apps/api/src/services/metricsService.ts`, `apps/api/src/routes/metrics.ts`)**:
   - `GET /api/admin/metrics?from=&to=` (Admin only; defaults to last 30 days) returning aggregated metrics with `value`, `n`, `target`, `formula`, and `insufficient_data`.
   - `GET /api/admin/metrics.csv?from=&to=` (Admin only) returning the matching CSV export.
   - **Privacy & Aggregation**: No endpoint returns individual incident rows, locations, or user identities. Duress incidents are included in aggregates and never singled out.
   - **Minimum Sample Rule**: Any metric (or sub-series such as per-channel delivery or weekly safety pulse) with `n < 5` returns `insufficient_data: true` and `value: null`.

---

## 2. Exact Metric Formulas

1. **Alert-Initiation Time (`alert_initiation_time`)**:
   - **Formula**: `median(server_created_at - client_created_at)` in seconds for online-created primary incidents (`queued_offline = false`) with `0 <= duration <= 300s`. The cancel window is NOT part of initiation time.
   - **Clock Skew Note**: Client clocks can be wrong; implausible initiation values (`< 0s` or `> 300s`) are excluded from the initiation-time median and counted in `excluded_implausible`.
   - **Offline-Queued Separation**: Incidents with `queued_offline = true` are excluded from the online initiation median and reported separately under `queued_then_delivered` (`{ label: 'queued-then-delivered', n, value, insufficient_data }`).
   - **Target**: `under 10 s`.

2. **Time to Active (`time_to_active`)**:
   - **Formula**: `median(activated_at - created_at)` in seconds for incidents that reached `ACTIVE` (includes the user cancel window; marked `informational: true`).
   - **Target**: `informational (includes cancel window)`.

3. **Notification Delivery Rate (`notification_delivery_rate`)**:
   - **Formula**: `count(status IN ('sent', 'delivered')) / count(all_notifications_attempted) * 100`, computed overall and per channel (`sms`, `push`, `gateway` in `by_channel`).
   - **Target**: `above 95%` (labeled `environment_label: "test environment"` when using mock providers).

4. **Time to First Acknowledgement (`time_to_first_acknowledgement`)**:
   - **Formula**: `median` and `p90` (nearest-rank `sorted[ceil(0.9 * n) - 1]`) of `(first_ACKNOWLEDGED_event.created_at - activated_at)` in seconds for active incidents with an `ACKNOWLEDGED` event.
   - **Target**: `null`.

5. **Time to Resolution (`time_to_resolution`)**:
   - **Formula**: `median(resolved_at - activated_at)` in seconds for active incidents that reached `RESOLVED`.
   - **Target**: `null`.

6. **Cancellation Rate (`cancellation_rate`) & False-Alarm Rate (`false_alarm_rate`)**:
   - **Cancellation Rate Formula**: `count(status = 'CANCELLED') / count(all_incidents) * 100`.
   - **False-Alarm Rate Formula**: `count(status = 'FALSE_ALARM' among active) / count(incidents_reaching_ACTIVE) * 100`.
   - **Target**: `null`.

7. **Location Availability (`location_availability`)**:
   - **Formula**: `count(active_incidents_with_location_sample) / count(incidents_reaching_ACTIVE) * 100`, plus `median_accuracy_meters = median(location_samples.accuracy_m)` across active incidents' location samples, and `location_consent_off_count` reported separately.
   - **Target**: `null`.

8. **Audit Completeness (`audit_completeness`)**:
   - **Formula**: `count(incidents_with_valid_incident_events_chain_from_TRIGGERED_to_current_status) / count(all_incidents) * 100`, where every state transition in `incident_events` follows `ALLOWED_TRANSITIONS` from initial `TRIGGERED` to `incident.status`.
   - **Target**: `100%`.

9. **Safety Pulse (`safety_pulse`)**:
   - **Formula**: `avg(safety_score)` and `count(avoided_going_somewhere = true) / count(safety_pulses) * 100`, computed overall and grouped by ISO week (`by_week`, each applying the `n < 5` minimum sample rule).
   - **Target**: `null`.

10. **Post-Incident Trust Score (`post_incident_trust_score`)**:
    - **Formula**: `avg(post_incident_ratings.score)` on the 1–5 scale.
    - **Target**: `null`.

---

## 3. What Was NOT Done (Out of Scope for Phase 8A)
- Admin metrics dashboard UI and post-incident rating UI prompt (deferred to Phase 8B).
- User privacy data export/deletion tools (deferred to Phase 8C).
- Guided Demo Mode (deferred to Phase 8D).

## 4. What the Next Phase (Phase 8B) Can Rely On
- `POST /api/incidents/:id/rating` accepts `{ score: 1..5 }` from the incident owner once after incident closure (including masked duress view).
- `GET /api/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD` and `GET /api/admin/metrics.csv` return all 10 aggregated metrics with `value`, `n`, `target`, `formula`, `insufficient_data`, `excluded_implausible` on `alert_initiation_time`, channel breakdowns, and weekly safety pulse series.

---

## 5. Requirement-to-Test Map (`apps/api/src/tests/phase8a_metrics.test.ts`)

- **a. Initiation time: fixture with hand-computed median (arithmetic in the test comment)**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON` (and clock-skew exclusion in `4. Clock skew: excludes implausible initiation values (negative or > 300 seconds) from initiation-time median and reports excluded_implausible count`)
- **b. Offline-queued alerts excluded from the initiation median and reported separately**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **c. Time to active**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **d. Delivery rate overall and per channel**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **e. Time to first acknowledgement (median and p90)**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **f. Time to resolution**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **g. Cancellation rate and false-alarm rate**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **h. Location availability and median accuracy, consent-off count**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **i. Audit completeness**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **j. Safety pulse average and % avoided, by week**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **k. Post-incident rating average**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **l. insufficient_data when fewer than 5 points**: `2. Admin-only access control (403 for user and responder) & Minimum Sample Rule (insufficient_data: true and value: null when n < 5)` (and per-channel / per-week sub-buckets in `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`)
- **m. 403 for role user and role responder on /api/admin/metrics and .csv**: `2. Admin-only access control (403 for user and responder) & Minimum Sample Rule (insufficient_data: true and value: null when n < 5)`
- **n. CSV values match the JSON**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`
- **o. Rating: owner only, once only (409), only after close (400), allowed on a duress incident without changing it**: `1. POST /api/incidents/:id/rating: owner only, allowed only after close (or masked duress view without changing incident), once per incident, and stores no user_id`
- **p. No endpoint returns per-incident rows**: `3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON`

## 6. Verification Totals
- `Test Files  24 passed (24) | Tests  115 passed (115)`

