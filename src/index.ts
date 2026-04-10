import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import dotenv from "dotenv";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FLUSH_DELAY,
  DEFAULT_API_ENDPOINT,
  DEFAULT_SERVICER_ENDPOINT,
} from "./constants";
import AsyncLock from "async-lock";
import { v7 as uuidv7 } from "uuid";

// Define logging levels as const enum for better tree-shaking
export const enum LogLevel {
  None = 0,
  Error = 1,
  Info = 2,
  Debug = 3,
}

export interface Config {
  key?: string;
  apiEndpoint?: string;
  servicerEndpoint?: string;
  logLevel?: LogLevel;
  retries?: number;
  timeout?: number;
  batchSize?: number;
  flushDelay?: number;
  maxQueueSize?: number;
}

/**
 * @deprecated Use Config.
 */
export type Options = Config;

export interface Log {
  log_id?: string;
  agent?: string;
  event: string;
  value: number;
  meta?: unknown;
  occurred_at?: string | Date;
}

export interface Event {
	readonly event_id: string;
	readonly agent?: string;
	readonly event: string;
	readonly title?: string;
	readonly public: boolean;
	readonly description?: string;
	readonly unit?: string;
	readonly timezone: string;
	readonly created_at?: string;
}

export interface CreateEventPayload {
	agent?: string;
	event: string;
	title?: string;
	public?: boolean;
	description?: string;
	unit?: string;
	timezone?: string;
}

export interface Policy {
	readonly policy_id: string;
	readonly event_id: string;
	readonly title: string;
	readonly description?: string;
	readonly channel: string;
	readonly period: string;
	readonly aggregate: string;
	readonly condition: string;
	readonly threshold: number;
	readonly severity: string;
	readonly enabled: boolean;
}

export type CreatePolicyPayload = Omit<Policy, "policy_id">;

export type UpdatePolicyPayload = Partial<Omit<Policy, "policy_id">>;

export interface Alert {
	readonly alert_id: string;
	readonly policy_id: string;
	readonly event_id: string;
	readonly agent?: string;
	readonly event: string;
	readonly title: string;
	readonly period: string;
	readonly aggregate: string;
	readonly condition: string;
	readonly threshold: number;
	readonly severity: string;
	readonly status: string;
	readonly value: number;
	readonly count: number;
	readonly min: number;
	readonly max: number;
	readonly triggered_at?: string;
	readonly acknowledged_at?: string;
	readonly resolved_at?: string;
}

export interface AlertDelivery {
	readonly attempt_id: string;
	readonly alert_id: string;
	readonly destination_id?: string;
	readonly channel: string;
	readonly target: string;
	readonly status: string;
	readonly response_status?: number;
	readonly error_message?: string;
	readonly created_at: string;
}

export interface Destination {
	readonly destination_id: string;
	readonly channel: string;
	readonly url?: string;
	readonly credentials?: Record<string, unknown>;
	readonly scope: string;
	readonly policy_ids?: string[];
	readonly enabled: boolean;
}

export type CreateDestinationPayload = Omit<Destination, "destination_id">;

export type UpdateDestinationPayload = Partial<Omit<Destination, "destination_id">>;

export interface EventLogPoint {
	readonly event_id: string;
	readonly agent?: string;
	readonly event: string;
	readonly period: string;
	readonly occurred_at: string;
	readonly count: number;
	readonly value: number;
	readonly squares: number;
	readonly min: number;
	readonly max: number;
}

export interface AnalyticsWindowQuery {
	view: "window";
	period: "1h" | "1d" | "7d" | "1m";
	previous: "previous_window" | "previous_1d" | "previous_7d" | "previous_1m";
}

export interface AnalyticsWindowData {
	readonly current_value: number;
	readonly current_count: number;
	readonly previous_value: number;
	readonly previous_count: number;
	readonly value_delta: number;
	readonly count_delta: number;
	readonly value_pct_change: number;
	readonly count_pct_change: number;
	readonly current_mean: number;
	readonly previous_mean: number;
	readonly mean_delta: number;
	readonly mean_pct_change: number;
	readonly current_stddev: number;
	readonly previous_stddev: number;
}

export interface AnalyticsWindowResponse {
	readonly event_id: string;
	readonly view: "window";
	readonly period: "1h" | "1d" | "7d" | "1m";
	readonly previous: "previous_window" | "previous_1d" | "previous_7d" | "previous_1m";
	readonly data: AnalyticsWindowData | null;
}

export interface DestinationTestResult {
	readonly alert_id: string;
	readonly destination_id: string;
	readonly status: string;
}

export interface PaginationOptions {
	period?: "minute" | "hour" | "day";
	limit?: number;
	offset?: number;
}

export type DeliveryKind = "alert" | "test" | "all";

// Custom error class for Chirpier-specific errors
export class ChirpierError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ChirpierError";
    Object.setPrototypeOf(this, ChirpierError.prototype);
  }
}

interface QueuedLog {
  readonly log: Log;
  readonly timestamp: number;
}

export class Client {
  private readonly apiKey: string;
  private readonly apiEndpoint: string;
  private readonly servicerEndpoint: string;
  private readonly retries: number;
  private readonly timeout: number;
  private readonly axiosInstance: AxiosInstance;
  private logQueue: QueuedLog[] = [];
  private readonly batchSize: number;
  private readonly flushDelay: number;
  private flushTimeoutId: NodeJS.Timeout | null = null;
  private readonly queueLock: AsyncLock;
  private readonly flushLock: AsyncLock;
  private readonly logLevel: LogLevel;

  constructor(options: Config = {}) {
    const {
      key: providedKey,
      apiEndpoint = DEFAULT_API_ENDPOINT,
      servicerEndpoint = DEFAULT_SERVICER_ENDPOINT,
      logLevel = LogLevel.None,
      retries = DEFAULT_RETRIES,
      timeout = DEFAULT_TIMEOUT,
      batchSize = DEFAULT_BATCH_SIZE,
      flushDelay = DEFAULT_FLUSH_DELAY,
      maxQueueSize,
    } = options;

    const key = resolveAPIKey(providedKey);

    if (!key) {
      throw new ChirpierError("API key is required", "INVALID_KEY");
    }

    if (!isValidAPIKey(key)) {
      throw new ChirpierError("Invalid API key: must start with 'chp_'", "INVALID_KEY");
    }

    if (apiEndpoint !== undefined) {
      if (typeof apiEndpoint !== "string" || apiEndpoint.trim().length === 0) {
        throw new ChirpierError(
          "apiEndpoint must be a non-empty string",
          "INVALID_API_ENDPOINT"
        );
      }

      let parsedURL: URL;
      try {
        parsedURL = new URL(apiEndpoint);
      } catch {
        throw new ChirpierError(
          "apiEndpoint must be a valid absolute URL",
          "INVALID_API_ENDPOINT"
        );
      }

      if (parsedURL.protocol !== "https:" && parsedURL.protocol !== "http:") {
        throw new ChirpierError(
          "apiEndpoint must use http or https",
          "INVALID_API_ENDPOINT"
        );
      }
    }

    // Validate numeric options
    if (retries < 0 || !Number.isInteger(retries)) {
      throw new ChirpierError("Retries must be a non-negative integer", "INVALID_RETRIES");
    }
    if (timeout <= 0) {
      throw new ChirpierError("Timeout must be positive", "INVALID_TIMEOUT");
    }
    if (batchSize <= 0 || !Number.isInteger(batchSize)) {
      throw new ChirpierError("Batch size must be a positive integer", "INVALID_BATCH_SIZE");
    }
    if (flushDelay < 0) {
      throw new ChirpierError("Flush delay must be non-negative", "INVALID_FLUSH_DELAY");
    }
    this.apiEndpoint = apiEndpoint ?? DEFAULT_API_ENDPOINT;
    this.servicerEndpoint = servicerEndpoint ?? DEFAULT_SERVICER_ENDPOINT;
    this.apiKey = key;
    this.retries = retries;
    this.timeout = timeout;
    this.batchSize = batchSize;
    this.flushDelay = flushDelay;
    this.logLevel = logLevel;

    void maxQueueSize;
    this.queueLock = new AsyncLock();
    this.flushLock = new AsyncLock();

    this.axiosInstance = axios.create({
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: this.timeout,
    });

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => Promise.reject(error)
    );

    axiosRetry(this.axiosInstance, {
      retries: this.retries,
      retryDelay: (retryCount) => {
        const baseDelay = Math.pow(2, retryCount) * 1000;
        const jitter = Math.random() * 0.3 * baseDelay;
        return baseDelay + jitter;
      },
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkError(error) ||
          axiosRetry.isRetryableError(error) ||
          (error.response && error.response.status) === 429
        );
      },
      shouldResetTimeout: true,
    });
  }

  private isValidLog(log: Log): boolean {
    const now = Date.now();
    const oldestAllowed = now - 30 * 24 * 60 * 60 * 1000;
    const newestAllowed = now + 24 * 60 * 60 * 1000;

    if (typeof log.event !== "string" || log.event.trim().length === 0) {
      return false;
    }

    if (log.log_id !== undefined) {
      if (typeof log.log_id !== "string") {
        return false;
      }

      const trimmedLogID = log.log_id.trim();
      if (trimmedLogID.length > 0 && !isUUID(trimmedLogID)) {
        return false;
      }
    }

    if (typeof log.value !== "number" || !Number.isFinite(log.value)) {
      return false;
    }

    if (log.agent !== undefined && typeof log.agent !== "string") {
      return false;
    }

    if (log.meta !== undefined) {
      try {
        const serializedMeta = JSON.stringify(log.meta);
        if (serializedMeta === undefined) {
          return false;
        }
      } catch {
        return false;
      }
    }

    if (log.occurred_at !== undefined) {
      const occurredAtMillis =
        log.occurred_at instanceof Date
          ? log.occurred_at.getTime()
          : new Date(log.occurred_at).getTime();

      if (!Number.isFinite(occurredAtMillis)) {
        return false;
      }

      if (occurredAtMillis < oldestAllowed || occurredAtMillis > newestAllowed) {
        return false;
      }
    }

    return true;
  }

  private normalizeLog(log: Log): Log {
    const normalizedLog: Log = {
      log_id: resolveLogID(log.log_id),
      event: log.event.trim(),
      value: log.value,
    };

    if (typeof log.agent === "string") {
      const trimmedAgent = log.agent.trim();
      if (trimmedAgent.length > 0) {
        normalizedLog.agent = trimmedAgent;
      }
    }

    if (log.meta !== undefined) {
      normalizedLog.meta = log.meta;
    }

    if (log.occurred_at !== undefined) {
      const occurredAtDate =
        log.occurred_at instanceof Date ? log.occurred_at : new Date(log.occurred_at);
      normalizedLog.occurred_at = occurredAtDate.toISOString();
    }

    return normalizedLog;
  }

  public async log(log: Log): Promise<void> {
    if (!this.isValidLog(log)) {
      throw new ChirpierError(
        "Invalid log format: log_id must be a UUID when provided, event must not be empty, value must be a finite number, agent must be a string when provided, meta must be JSON-encodable, and occurred_at must be within the last 30 days and no more than 1 day in the future",
        "INVALID_LOG"
      );
    }

    const normalizedLog = this.normalizeLog(log);

    await this.queueLock.acquire("queue", async () => {
      this.logQueue.push({ log: normalizedLog, timestamp: Date.now() });
    });

    if (this.logQueue.length >= this.batchSize) {
      await this.flushQueue();
    } else if (!this.flushTimeoutId) {
      this.flushTimeoutId = setTimeout(
        () => this.flushQueue(),
        this.flushDelay
      );
    }
  }

  private async flushQueue(): Promise<void> {
    await this.flushLock.acquire("flush", async () => {
      let logsToSend: QueuedLog[] = [];

      await this.queueLock.acquire("logQueue", async () => {
        if (this.logQueue.length > 0) {
          logsToSend = [...this.logQueue];
          this.logQueue = [];
        }
      });

      if (logsToSend.length === 0) {
        return;
      }

      try {
        if (this.flushTimeoutId) {
          clearTimeout(this.flushTimeoutId);
          this.flushTimeoutId = null;
        }

        await this.sendLogs(logsToSend.map((queuedLog) => queuedLog.log));

        if (this.logLevel >= LogLevel.Info) {
          console.info(`Successfully sent ${logsToSend.length} logs`);
        }
      } catch (error) {
        if (this.logLevel >= LogLevel.Error) {
          console.error("Failed to send logs:", error);
        }

        await this.queueLock.acquire("logQueue", async () => {
          this.logQueue = [...logsToSend, ...this.logQueue];
        });
      }
    });
  }

  private async sendLogs(logs: Log[]): Promise<void> {
    await this.axiosInstance.post(this.apiEndpoint, logs);
  }

  public async flush(): Promise<void> {
    await this.flushQueue();
  }

  public async shutdown(): Promise<void> {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    await this.flushQueue();
  }

  public async close(): Promise<void> {
    await this.shutdown();
  }

  public async listEvents(): Promise<Event[]> {
	const response = await this.axiosInstance.get<Event[]>(`${this.servicerEndpoint}/events`);
	return response.data;
  }

  public async createEvent(payload: CreateEventPayload): Promise<Event> {
	const response = await this.axiosInstance.post<Event>(`${this.servicerEndpoint}/events`, payload);
	return response.data;
  }

  public async getEvent(eventID: string): Promise<Event> {
	const response = await this.axiosInstance.get<Event>(`${this.servicerEndpoint}/events/${eventID}`);
	return response.data;
  }

  public async updateEvent(
	eventID: string,
	payload: Partial<Omit<Event, "event_id" | "created_at">>
  ): Promise<Event> {
	const response = await this.axiosInstance.put<Event>(
		`${this.servicerEndpoint}/events/${eventID}`,
		payload
	);
	return response.data;
  }

  public async listPolicies(): Promise<Policy[]> {
	const response = await this.axiosInstance.get<Policy[]>(`${this.servicerEndpoint}/policies`);
	return response.data;
  }

  public async getPolicy(policyID: string): Promise<Policy> {
	const response = await this.axiosInstance.get<Policy>(`${this.servicerEndpoint}/policies/${policyID}`);
	return response.data;
  }

  public async createPolicy(payload: CreatePolicyPayload): Promise<Policy> {
	const response = await this.axiosInstance.post<Policy>(`${this.servicerEndpoint}/policies`, payload);
	return response.data;
  }

  public async updatePolicy(policyID: string, payload: UpdatePolicyPayload): Promise<Policy> {
	const response = await this.axiosInstance.put<Policy>(`${this.servicerEndpoint}/policies/${policyID}`, payload);
	return response.data;
  }

  public async listAlerts(status?: string): Promise<Alert[]> {
	const endpoint = status
		? `${this.servicerEndpoint}/alerts?status=${encodeURIComponent(status)}`
		: `${this.servicerEndpoint}/alerts`;
	const response = await this.axiosInstance.get<Alert[]>(endpoint);
	return response.data;
  }

  public async getAlert(alertID: string): Promise<Alert> {
	const response = await this.axiosInstance.get<Alert>(`${this.servicerEndpoint}/alerts/${alertID}`);
	return response.data;
  }

  public async getAlertDeliveries(alertID: string, options: { limit?: number; offset?: number; kind?: DeliveryKind } = {}): Promise<AlertDelivery[]> {
	const params = new URLSearchParams();
	if (options.kind) {
		params.set("kind", options.kind);
	}
	if (typeof options.limit === "number") {
		params.set("limit", String(options.limit));
	}
	if (typeof options.offset === "number") {
		params.set("offset", String(options.offset));
	}
	const suffix = params.toString() ? `?${params.toString()}` : "";
	const response = await this.axiosInstance.get<AlertDelivery[]>(`${this.servicerEndpoint}/alerts/${alertID}/deliveries${suffix}`);
	return response.data;
  }

  public async acknowledgeAlert(alertID: string): Promise<Alert> {
	const response = await this.axiosInstance.post<Alert>(`${this.servicerEndpoint}/alerts/${alertID}/acknowledge`);
	return response.data;
  }

  public async archiveAlert(alertID: string): Promise<Alert> {
	const response = await this.axiosInstance.post<Alert>(`${this.servicerEndpoint}/alerts/${alertID}/archive`);
	return response.data;
  }

  public async listDestinations(): Promise<Destination[]> {
	const response = await this.axiosInstance.get<Destination[]>(`${this.servicerEndpoint}/destinations`);
	return response.data;
  }

  public async createDestination(payload: CreateDestinationPayload): Promise<Destination> {
	const response = await this.axiosInstance.post<Destination>(`${this.servicerEndpoint}/destinations`, payload);
	return response.data;
  }

  public async getDestination(destinationID: string): Promise<Destination> {
	const response = await this.axiosInstance.get<Destination>(`${this.servicerEndpoint}/destinations/${destinationID}`);
	return response.data;
  }

  public async updateDestination(destinationID: string, payload: UpdateDestinationPayload): Promise<Destination> {
	const response = await this.axiosInstance.put<Destination>(`${this.servicerEndpoint}/destinations/${destinationID}`, payload);
	return response.data;
  }

  public async testDestination(destinationID: string): Promise<DestinationTestResult> {
	const response = await this.axiosInstance.post<DestinationTestResult>(`${this.servicerEndpoint}/destinations/${destinationID}/test`);
	return response.data;
  }

  public async getEventLogs(eventID: string, options: PaginationOptions = {}): Promise<EventLogPoint[]> {
	const params = new URLSearchParams();
	if (options.period) {
		params.set("period", options.period);
	}
	if (typeof options.limit === "number") {
		params.set("limit", String(options.limit));
	}
	if (typeof options.offset === "number") {
		params.set("offset", String(options.offset));
	}
	const suffix = params.toString() ? `?${params.toString()}` : "";
	const response = await this.axiosInstance.get<EventLogPoint[]>(`${this.servicerEndpoint}/events/${eventID}/logs${suffix}`);
	return response.data;
  }

  public async getEventAnalytics(eventID: string, query: AnalyticsWindowQuery): Promise<AnalyticsWindowResponse> {
	const params = new URLSearchParams();
	params.set("view", query.view);
	params.set("period", query.period);
	params.set("previous", query.previous);
	const response = await this.axiosInstance.get<AnalyticsWindowResponse>(`${this.servicerEndpoint}/events/${eventID}/analytics?${params.toString()}`);
	return response.data;
  }

  public async resolveAlert(alertID: string): Promise<Alert> {
	const response = await this.axiosInstance.post<Alert>(`${this.servicerEndpoint}/alerts/${alertID}/resolve`);
	return response.data;
  }

}

let instance: Client | null = null;

export function createClient(config: Config = {}): Client {
  return new Client(config);
}

function isNodeEnvironment(): boolean {
  return typeof process !== "undefined" && !!(process.versions && process.versions.node);
}

function isValidAPIKey(token: string): boolean {
  return token.startsWith("chp_") && token.length > "chp_".length;
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveLogID(logID?: string): string {
  if (typeof logID === "string") {
    const trimmedLogID = logID.trim();
    if (trimmedLogID.length > 0) {
      return trimmedLogID;
    }
  }

  return uuidv7();
}

function loadDotEnvKey(): string | undefined {
  if (!isNodeEnvironment()) {
    return undefined;
  }

  try {
    dotenv.config({ path: ".env", override: false });
  } catch {
    return undefined;
  }

  const envKey = process.env.CHIRPIER_API_KEY;
  if (typeof envKey !== "string") {
    return undefined;
  }

  const trimmedKey = envKey.trim();
  return trimmedKey.length > 0 ? trimmedKey : undefined;
}

function resolveAPIKey(providedKey?: string): string | undefined {
  if (typeof providedKey === "string" && providedKey.trim().length > 0) {
    return providedKey.trim();
  }

  if (typeof process !== "undefined" && process.env && typeof process.env.CHIRPIER_API_KEY === "string") {
    const envKey = process.env.CHIRPIER_API_KEY.trim();
    if (envKey.length > 0) {
      return envKey;
    }
  }

  return loadDotEnvKey();
}

export function initialize(options: Config = {}): void {
  const resolvedKey = resolveAPIKey(options.key);
  if (!resolvedKey) {
    throw new ChirpierError("API key is required", "INVALID_KEY");
  }

  if (!isValidAPIKey(resolvedKey)) {
    throw new ChirpierError("Invalid API key: must start with 'chp_'", "INVALID_KEY");
  }

  if (instance) {
    return;
  }

  try {
    instance = new Client({ ...options, key: resolvedKey });
  } catch (error) {
    if (error instanceof ChirpierError) {
      if (options.logLevel && options.logLevel >= LogLevel.Error) {
        console.error("Failed to initialize Chirpier SDK:", error.message);
      }
    } else {
      if (options.logLevel && options.logLevel >= LogLevel.Error) {
        console.error(
          "An unexpected error occurred during Chirpier SDK initialization:",
          error
        );
      }
    }
    throw error;
  }
}

export async function logEvent(log: Log): Promise<void> {
  if (!instance) {
    throw new ChirpierError(
      "Chirpier SDK is not initialized. Please call initialize() first.",
      "NOT_INITIALIZED"
    );
  }

  await instance.log(log);
}

export async function stop(): Promise<void> {
  if (!instance) {
    return;
  }

  await instance.shutdown();
  instance = null;
}

export async function flush(): Promise<void> {
  if (!instance) {
    throw new ChirpierError(
      "Chirpier SDK is not initialized. Please call initialize() first.",
      "NOT_INITIALIZED"
    );
  }

  await instance.flush();
}
