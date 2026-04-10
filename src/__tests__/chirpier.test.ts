import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import {
  Client,
  ChirpierError,
  Log,
  LogLevel,
  createClient,
  flush,
  initialize,
  logEvent,
  stop,
} from "../index";
import {
  DEFAULT_API_ENDPOINT,
} from "../constants";

describe("Chirpier SDK", () => {
  afterEach(async () => {
    await stop();
  });

  describe("Initialization", () => {
    test("should throw error if logEvent is called before initialize", async () => {
      const log: Log = {
        event: "test-event",
        value: 1,
      };

      await expect(logEvent(log)).rejects.toThrow(ChirpierError);
      await expect(logEvent(log)).rejects.toThrow(
        "Chirpier SDK is not initialized. Please call initialize() first."
      );
    });

    test("should initialize with default values", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_test_default_key",
        logLevel: LogLevel.None,
      });

      await logEvent({ event: "sdk.initialized", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(mock.history.post[0].url).toBe(DEFAULT_API_ENDPOINT);
    });

    test("should initialize with custom apiEndpoint", async () => {
      const customEndpoint = "https://localhost:3001/v1.0/logs";
      const mock = new MockAdapter(axios);
      mock.onPost(customEndpoint).reply(200, { success: true });

      initialize({
        key: "chp_test_custom_endpoint",
        apiEndpoint: customEndpoint,
        logLevel: LogLevel.None,
      });

      await logEvent({ event: "sdk.custom-endpoint", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(mock.history.post[0].url).toBe(customEndpoint);
    });

    test("should throw error for invalid apiEndpoint", () => {
      expect(() => {
        initialize({
          key: "chp_test_invalid_endpoint",
          apiEndpoint: "not-a-url",
        });
      }).toThrow("apiEndpoint must be a valid absolute URL");
    });

    test("should throw error for invalid key prefix", () => {
      expect(() => {
        initialize({
          key: "invalid_key",
          logLevel: LogLevel.None,
        });
      }).toThrow("Invalid API key: must start with 'chp_'");
    });

    test("should load key from process environment", () => {
      const previousKey = process.env.CHIRPIER_API_KEY;
      process.env.CHIRPIER_API_KEY = "chp_env_key";

      try {
        initialize({ logLevel: LogLevel.None });
        expect(() => initialize({ logLevel: LogLevel.None })).not.toThrow();
      } finally {
        if (previousKey === undefined) {
          delete process.env.CHIRPIER_API_KEY;
        } else {
          process.env.CHIRPIER_API_KEY = previousKey;
        }
      }
    });

    test("should load key from .env fallback", () => {
      const previousKey = process.env.CHIRPIER_API_KEY;
      const previousCwd = process.cwd();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chirpier-js-"));

      try {
        delete process.env.CHIRPIER_API_KEY;
        fs.writeFileSync(path.join(tempDir, ".env"), "CHIRPIER_API_KEY=chp_dotenv_key\n");
        process.chdir(tempDir);

        initialize({ logLevel: LogLevel.None });
        expect(() => initialize({ logLevel: LogLevel.None })).not.toThrow();
      } finally {
        process.chdir(previousCwd);
        if (previousKey === undefined) {
          delete process.env.CHIRPIER_API_KEY;
        } else {
          process.env.CHIRPIER_API_KEY = previousKey;
        }
      }
    });
  });

  describe("logEvent", () => {
    test("log should be sent", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_log_send_key",
        logLevel: LogLevel.None,
      });

      const log: Log = {
        agent: "api.worker",
        event: "request.finished",
        value: 1,
      };

      await logEvent(log);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(mock.history.post.length).toBe(1);
      expect(mock.history.post[0].url).toBe(DEFAULT_API_ENDPOINT);
      expect(JSON.parse(mock.history.post[0].data)).toEqual([
        {
          log_id: expect.any(String),
          agent: "api.worker",
          event: "request.finished",
          value: 1,
        },
      ]);
      expect(JSON.parse(mock.history.post[0].data)[0].log_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    test("should preserve provided log_id", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_log_id_key",
        logLevel: LogLevel.None,
      });

      await logEvent({
        log_id: "9f97d65f-fb30-4062-b4d0-8617c03fe4f6",
        event: "request.finished",
        value: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const payload = JSON.parse(mock.history.post[0].data);
      expect(payload[0].log_id).toBe("9f97d65f-fb30-4062-b4d0-8617c03fe4f6");
    });

    test("agent whitespace should be omitted", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_log_whitespace_agent",
        logLevel: LogLevel.None,
      });

      await logEvent({
        agent: "   ",
        event: "metric.tick",
        value: 42,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const payload = JSON.parse(mock.history.post[0].data);
      expect(payload[0].agent).toBeUndefined();
    });

    test("should support meta payload", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_log_meta_key",
        logLevel: LogLevel.None,
      });

      await logEvent({
        agent: "api.worker",
        event: "request.finished",
        value: 200,
        meta: {
          path: "/v1.0/logs",
          status: "ok",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const payload = JSON.parse(mock.history.post[0].data);
      expect(payload[0].meta.path).toBe("/v1.0/logs");
    });

    test("should support occurred_at timestamp", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_log_occurred_at_key",
        logLevel: LogLevel.None,
      });

      const occurredAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

      await logEvent({
        event: "request.finished",
        value: 1,
        occurred_at: occurredAt,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const payload = JSON.parse(mock.history.post[0].data);
      expect(payload[0].occurred_at).toBe(occurredAt.toISOString());
    });

    test("should throw error for invalid log", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_invalid_log_key",
        logLevel: LogLevel.Debug,
      });

      await expect(
        logEvent({
          event: "",
          value: 0,
        })
      ).rejects.toThrow(ChirpierError);

      await expect(
        logEvent({
          event: "too-old",
          value: 1,
          occurred_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        })
      ).rejects.toThrow(ChirpierError);

      await expect(
        logEvent({
          event: "too-future",
          value: 1,
          occurred_at: new Date(Date.now() + 25 * 60 * 60 * 1000),
        })
      ).rejects.toThrow(ChirpierError);

      await expect(
        logEvent({
          log_id: "not-a-uuid",
          event: "bad-log-id",
          value: 1,
        })
      ).rejects.toThrow(ChirpierError);

      expect(mock.history.post.length).toBe(0);
    });

    test("should batch logs and flush when batch size is reached", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_batch_key",
        logLevel: LogLevel.None,
      });

      await logEvent({ event: "batch.event", value: 1 });
      await logEvent({ event: "batch.event", value: 2 });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data).length).toBe(2);
    });
  });

  describe("Client API", () => {
    test("createClient supports direct logging", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      const client: Client = createClient({ key: "chp_direct_client_key" });
      await client.log({
        event: "direct.client.log",
        value: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data)[0].event).toBe("direct.client.log");

      await client.shutdown();
    });

    test("flush should force delivery of queued logs", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "chp_flush_key",
        logLevel: LogLevel.None,
        flushDelay: 10000,
      });

      await logEvent({ event: "queued.before.flush", value: 1 });
      expect(mock.history.post.length).toBe(0);

      await flush();
      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data)[0].event).toBe("queued.before.flush");
    });

    test("getEventLogs uses servicer endpoint with period, limit, and offset", async () => {
      const mock = new MockAdapter(axios);
      mock.onGet("https://api.chirpier.co/v1.0/events/evt_123/logs?period=hour&limit=25&offset=10").reply(200, []);

      const client: Client = createClient({ key: "chp_client_logs_key" });
      try {
        await client.getEventLogs("evt_123", { period: "hour", limit: 25, offset: 10 });
        expect(mock.history.get[0].url).toBe("https://api.chirpier.co/v1.0/events/evt_123/logs?period=hour&limit=25&offset=10");
      } finally {
        await client.shutdown();
      }
    });

	  test("event, policy, alert, and destination helpers use servicer endpoints", async () => {
		const mock = new MockAdapter(axios);
		mock.onPost("https://api.chirpier.co/v1.0/events").reply(200, { event_id: "evt_123", event: "tool.errors.count", public: false, timezone: "UTC" });
		mock.onGet("https://api.chirpier.co/v1.0/events/evt_123").reply(200, { event_id: "evt_123", event: "tool.errors.count", public: false, timezone: "UTC" });
		mock.onGet("https://api.chirpier.co/v1.0/policies/pol_123").reply(200, { policy_id: "pol_123", event_id: "evt_123", title: "Policy", channel: "ops", period: "hour", aggregate: "sum", condition: "gt", threshold: 1, severity: "warning", enabled: true });
		mock.onPut("https://api.chirpier.co/v1.0/policies/pol_123").reply(200, { policy_id: "pol_123", event_id: "evt_123", title: "Updated", channel: "ops", period: "hour", aggregate: "sum", condition: "gt", threshold: 1, severity: "warning", enabled: true });
		mock.onGet("https://api.chirpier.co/v1.0/alerts/alrt_123").reply(200, { alert_id: "alrt_123", policy_id: "pol_123", event_id: "evt_123", event: "tool.errors.count", title: "Alert", channel: "ops", period: "hour", aggregate: "sum", condition: "gt", threshold: 1, severity: "warning", status: "triggered", value: 2, count: 2, min: 1, max: 1 });
		mock.onGet("https://api.chirpier.co/v1.0/destinations").reply(200, []);
		mock.onPost("https://api.chirpier.co/v1.0/destinations").reply(200, { destination_id: "dst_123", channel: "slack", scope: "all", enabled: true });
		mock.onGet("https://api.chirpier.co/v1.0/destinations/dst_123").reply(200, { destination_id: "dst_123", channel: "slack", scope: "all", enabled: true });
		mock.onPut("https://api.chirpier.co/v1.0/destinations/dst_123").reply(200, { destination_id: "dst_123", channel: "slack", scope: "all", enabled: false });

		const client: Client = createClient({ key: "chp_client_route_key" });
		try {
		  const createdEvent = await client.createEvent({ event: "tool.errors.count" });
		  expect(createdEvent.event_id).toBe("evt_123");
		  await client.getEvent("evt_123");
		  const policy = await client.getPolicy("pol_123");
		  expect(policy.policy_id).toBe("pol_123");
		  await client.updatePolicy("pol_123", { title: "Updated" });
		  const alert = await client.getAlert("alrt_123");
		  expect(alert.alert_id).toBe("alrt_123");
		  await client.listDestinations();
		  const destination = await client.createDestination({ channel: "slack", scope: "all", enabled: true });
		  expect(destination.destination_id).toBe("dst_123");
		  await client.getDestination("dst_123");
		  const updatedDestination = await client.updateDestination("dst_123", { enabled: false });
		  expect(updatedDestination.enabled).toBe(false);
		} finally {
		  await client.shutdown();
		}
	  });

    test("getAlertDeliveries uses pagination params", async () => {
      const mock = new MockAdapter(axios);
      mock.onGet("https://api.chirpier.co/v1.0/alerts/alrt_123/deliveries?kind=test&limit=20&offset=5").reply(200, []);

      const client: Client = createClient({ key: "chp_client_alert_key" });
      try {
        await client.getAlertDeliveries("alrt_123", { kind: "test", limit: 20, offset: 5 });
        expect(mock.history.get[0].url).toBe("https://api.chirpier.co/v1.0/alerts/alrt_123/deliveries?kind=test&limit=20&offset=5");
      } finally {
        await client.shutdown();
      }
    });

    test("archiveAlert posts to servicer endpoint", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost("https://api.chirpier.co/v1.0/alerts/alrt_123/archive").reply(200, {});

      const client: Client = createClient({ key: "chp_client_alert_key" });
      try {
        await client.archiveAlert("alrt_123");
        expect(mock.history.post[0].url).toBe("https://api.chirpier.co/v1.0/alerts/alrt_123/archive");
      } finally {
        await client.shutdown();
      }
    });

    test("testDestination posts to servicer endpoint", async () => {
      const mock = new MockAdapter(axios);
	  mock.onPost("https://api.chirpier.co/v1.0/destinations/whk_123/test").reply(200, {
		alert_id: "alrt_123",
		destination_id: "whk_123",
		status: "sent",
	  });

      const client: Client = createClient({ key: "chp_client_destination_key" });
      try {
		const result = await client.testDestination("whk_123");
		expect(result.alert_id).toBe("alrt_123");
        expect(mock.history.post[0].url).toBe("https://api.chirpier.co/v1.0/destinations/whk_123/test");
      } finally {
        await client.shutdown();
      }
    });

	  test("getEventAnalytics uses analytics endpoint", async () => {
		const mock = new MockAdapter(axios);
		mock.onGet("https://api.chirpier.co/v1.0/events/evt_123/analytics?view=window&period=1h&previous=previous_window").reply(200, {
		  event_id: "evt_123",
		  view: "window",
		  period: "1h",
		  previous: "previous_window",
		  data: null,
		});

		const client: Client = createClient({ key: "chp_client_analytics_key" });
		try {
		  const analytics = await client.getEventAnalytics("evt_123", {
			view: "window",
			period: "1h",
			previous: "previous_window",
		  });
		  expect(analytics.event_id).toBe("evt_123");
		  expect(mock.history.get[0].url).toBe("https://api.chirpier.co/v1.0/events/evt_123/analytics?view=window&period=1h&previous=previous_window");
		} finally {
		  await client.shutdown();
		}
	  });
  });
});
