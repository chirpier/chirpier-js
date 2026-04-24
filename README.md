# Chirpier SDK

The Chirpier SDK for JavaScript sends OpenClaw-friendly flat events to Chirpier/Ingres with automatic batching and retries.

## Installation

<!-- docs:start install -->
```bash
npm install @chirpier/chirpier-js
```
<!-- docs:end install -->

## Quick Start

<!-- docs:start quickstart -->
### Singleton API

```ts
import { initialize, logEvent, stop } from "@chirpier/chirpier-js";

initialize({ key: "chp_your_api_key" });

await logEvent({
  log_id: "9f97d65f-fb30-4062-b4d0-8617c03fe4f6",
  agent: "openclaw.main",
  event: "tool.errors.count",
  value: 1,
  meta: { tool_name: "browser.open", workflow: "triage" },
});

await stop();
```

### Instance API (Recommended)

```ts
import { createClient } from "@chirpier/chirpier-js";

const client = createClient({ key: "chp_your_api_key" });

await client.log({
  agent: "openclaw.main",
  event: "task.duration_ms",
  value: 420,
  meta: { task_name: "email_triage", result: "success" },
});

await client.flush();
await client.shutdown();
```
<!-- docs:end quickstart -->

## API

### `initialize(config)`

Initializes the SDK singleton.

`config`:
- `key` (string, optional): API key. Must start with `chp_`.
- `apiEndpoint` (string, optional): Full ingestion endpoint override.
- `servicerEndpoint` (string, optional): Control-plane endpoint override. Defaults to `https://api.chirpier.co/v1.0`.
- `logLevel` (enum, optional): `None | Error | Info | Debug`.
- `retries` (number, optional): Retry attempts.
- `timeout` (number, optional): HTTP timeout in ms.
- `batchSize` (number, optional): Flush size threshold.
- `flushDelay` (number, optional): Flush interval in ms.
- `maxQueueSize` (number, optional, deprecated): Ignored; queues grow in memory until flushed.

API key resolution precedence (when `key` is omitted):
1. `CHIRPIER_API_KEY` from process environment
2. `CHIRPIER_API_KEY` from `.env` in current working directory

Default ingest endpoint is `https://logs.chirpier.co/v1.0/logs`.
Default servicer endpoint is `https://api.chirpier.co/v1.0`.
The same bearer token is used for both ingest and servicer APIs.
Queued logs are not dropped locally because of queue capacity or retry exhaustion.

### Retry behavior

The SDK retries network/transport failures, `429` responses, and retryable `5xx` responses such as `502` and `504`.
It does not retry `401`, `403`, `404`, `500`, or `503`, and `401`/`403` errors surface the Chirpier response message when available.

### `logEvent(log)`

Queues a log for batched delivery.

Example with `occurred_at`:

```ts
await logEvent({
  agent: "openclaw.main",
  event: "tokens.used",
  value: 1530,
  occurred_at: "2026-03-05T14:30:00Z",
});
```

`log`:
- `agent` (string, optional): Free-form agent identifier text.
- `log_id` (string, optional): UUID idempotency key for the log. Generated automatically when omitted.
- `event` (string, required): Event name.
- `value` (number, required): Numeric value.
- `occurred_at` (string | Date, optional): Event occurrence timestamp.
- `meta` (JSON, optional): Additional JSON-encodable metadata.

Notes:
- `agent` whitespace-only values are treated as omitted.
- `log_id` blank values are treated as omitted and replaced with a generated UUIDv4.
- `event` must be non-empty after trimming.
- `occurred_at` must be within the last 30 days and no more than 1 day in the future.
- Use ISO8601 UTC timestamps, such as `2026-03-05T14:30:00Z`, or pass a `Date` instance.
- `meta` must be JSON-encodable.
- Unknown events are auto-created in Ingres as event definitions.

### `flush()`

Flushes pending logs for the initialized singleton without shutting down.

### `createClient(config)`

Creates a standalone `Client` instance (no global singleton state).

<!-- docs:start common-tasks -->
Client methods:
- `client.log(log)`: Queue a log.
- `client.flush()`: Flush queued logs.
- `client.shutdown()`: Flush and release timers/resources.
- `client.close()`: Alias of `client.shutdown()`.
- `client.listEvents()`: List event definitions using the servicer API.
- `client.getEvent(eventID)`: Read one event definition.
- `client.getEventAnalytics(eventID, query)`: Read analytics window comparisons.
- `client.updateEvent(eventID, payload)`: Update event definition metadata.
- `client.listPolicies()`: List monitors/policies.
- `client.createPolicy(payload)`: Create a monitor/policy.
- `client.listAlerts(status?)`: List alerts, optionally filtered by status.
- `client.getAlertDeliveries(alertID, { kind, limit, offset })`: Read alert delivery attempts. Defaults to real alerts only; use `kind: "test"` or `kind: "all"` as needed.
- `client.acknowledgeAlert(alertID)`: Acknowledge an alert.
- `client.resolveAlert(alertID)`: Resolve an alert.
- `client.archiveAlert(alertID)`: Archive an alert.
- `client.testDestination(destinationID)`: Send a destination test and return the synthetic test `alert_id`.
- `client.getEventLogs(eventID, { period, limit, offset })`: Read minute/hour/day event rollups.
<!-- docs:end common-tasks -->

### OpenClaw Example

```ts
const client = createClient({ key: "chp_your_api_key" });

await client.log({
  agent: "openclaw.main",
  event: "tool.errors.count",
  value: 1,
  meta: { tool_name: "browser.open" },
});

await client.log({
  agent: "openclaw.main",
  event: "task.duration_ms",
  value: 780,
  meta: { task_name: "daily_digest" },
});

await client.flush();

const events = await client.listEvents();
const toolErrors = events.find(
  (eventDef) => eventDef.agent === "openclaw.main" && eventDef.event === "tool.errors.count"
);

if (toolErrors) {
  const analytics = await client.getEventAnalytics(toolErrors.event_id, {
    view: "window",
    period: "1h",
    previous: "previous_window",
  });

  await client.createPolicy({
    event_id: toolErrors.event_id,
    title: "OpenClaw tool errors spike",
    condition: "gt",
    threshold: 5,
    enabled: true,
    channel: "default",
    period: "hour",
    aggregate: "sum",
    severity: "warning",
  });

  await client.getEventLogs(toolErrors.event_id, { period: "hour", limit: 24 });

  const destination = await client.createDestination({
    channel: "slack",
    url: "https://hooks.slack.com/services/T000/B000/secret",
    scope: "all",
    policy_ids: [],
    enabled: true,
  });

  const test = await client.testDestination(destination.destination_id);
  await client.getAlertDeliveries(test.alert_id, { kind: "test" });
}

await client.shutdown();
```

### `stop()`

Flushes pending logs and stops the SDK singleton.

## Testing

```bash
npm test
```

## Destination Setup Examples

Create a Slack destination for OpenClaw alerts:

```ts
await axios.post(
  "https://api.chirpier.co/v1.0/destinations",
  {
    url: "https://hooks.slack.com/services/T000/B000/secret",
    channel: "slack",
    scope: "all",
    policy_ids: [],
    enabled: true,
  },
  {
    headers: { Authorization: `Bearer ${process.env.CHIRPIER_API_KEY}` },
  }
);
```

Create a Telegram destination for OpenClaw alerts:

```ts
await axios.post(
  "https://api.chirpier.co/v1.0/destinations",
  {
    channel: "telegram",
    enabled: true,
    scope: "all",
    policy_ids: [],
    credentials: {
      bot_token: "123456:telegram-bot-token",
      chat_id: "987654321",
    },
  },
  {
    headers: { Authorization: `Bearer ${process.env.CHIRPIER_API_KEY}` },
  }
);
```

Send a test notification:

```ts
const result = await client.testDestination("whk_123");
await client.getAlertDeliveries(result.alert_id, { kind: "test" });
```
