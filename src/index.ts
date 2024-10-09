// Import necessary dependencies
import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { v4 as uuidv4 } from "@lukeed/uuid";
import { Base64 } from "js-base64";
import {
  DEFAULT_API_ENDPOINT,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT,
} from "./constants";

// Define the options interface for Chirpier initialization
interface Options {
  key: string;
  apiEndpoint?: string;
  retries?: number;
  timeout?: number;
  batchSize?: number;
  flushInterval?: number;
}

// Define the Event interface for monitoring
export interface Event {
  group_id: string;
  stream: string;
  value: number;
  event_id?: string;
}

// Custom error class for Chirpier-specific errors
export class ChirpierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChirpierError";
    Object.setPrototypeOf(this, ChirpierError.prototype);
  }
}

/**
 * Main Chirpier class for monitoring events.
 */
export class Chirpier {
  private readonly apiKey: string;
  private readonly apiEndpoint: string;
  private readonly retries: number;
  private readonly timeout: number;
  private readonly axiosInstance: AxiosInstance;
  private eventQueue: Event[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly batchSize: number;
  private readonly flushInterval: number;

  /**
   * Initializes a new instance of the Chirpier class.
   * @param options - Configuration options for the SDK.
   */
  constructor({
    key,
    apiEndpoint = DEFAULT_API_ENDPOINT,
    retries = DEFAULT_RETRIES,
    timeout = DEFAULT_TIMEOUT,
    batchSize = 100,
    flushInterval = 500,
  }: Options) {
    if (!key || typeof key !== "string") {
      throw new ChirpierError("API key is required and must be a string");
    }
    this.apiKey = key;
    this.apiEndpoint = apiEndpoint;
    this.retries = retries;
    this.timeout = timeout;
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;

    // Create axios instance with authorization header
    this.axiosInstance = axios.create({
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: this.timeout,
    });

    // Add the interceptor here
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        // Don't handle the error here; let axios-retry handle it
        return Promise.reject(error);
      }
    );

    // Apply axios-retry to your Axios instance
    axiosRetry(this.axiosInstance, {
      retries: this.retries,
      retryDelay: (retryCount) => {
        return Math.pow(2, retryCount) * 1000; // Exponential backoff starting at 1 second
      },
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error)
        );
      },
      shouldResetTimeout: true,
    });
  }

  /**
   * Validates the event structure.
   * @param event - The event to validate.
   * @returns True if valid, false otherwise.
   */
  private isValidEvent(event: Event): boolean {
    return (
      typeof event.group_id === "string" &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        event.group_id
      ) &&
      event.group_id.trim().length > 0 &&
      typeof event.stream === "string" &&
      event.stream.trim().length > 0 &&
      typeof event.value === "number"
    );
  }

  /**
   * Monitors an event by adding it to the queue and scheduling a flush if necessary.
   * @param event - The event to monitor.
   */
  public async monitor(event: Event): Promise<void> {
    if (!this.apiKey) {
      throw new ChirpierError("Chirpier SDK must be initialized before calling monitor()");
    }

    if (!this.isValidEvent(event)) {
      throw new ChirpierError(
        "Invalid event format. Must include group_id, stream, and numeric value."
      );
    }

    // Ensure event_id is only set once
    const eventWithID = { ...event, event_id: event.event_id || uuidv4() };

    this.eventQueue.push(eventWithID);

    if (this.eventQueue.length >= this.batchSize) {
      this.flushQueue();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(
        () => this.flushQueue(),
        this.flushInterval
      );
    }
  }

  /**
   * Flushes the event queue by sending all events to the API.
   */
  private async flushQueue(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }
    
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.sendEvents(eventsToSend);
      console.info(`Successfully sent ${eventsToSend.length} events`);
    } catch (error) {
      console.error("Failed to send events:", error);
    }

    // Schedule next flush if there are more events
    if (this.eventQueue.length > 0) {
      this.flushTimeout = setTimeout(
        () => this.flushQueue(),
        this.flushInterval
      );
    }
  }

  /**
   * Sends multiple events to the API in a batch.
   * @param events - The array of events to send.
   */
  private async sendEvents(events: Event[]): Promise<void> {
    await this.axiosInstance.post(this.apiEndpoint, events);
  }
}

/**
 * Decodes a base64url encoded string.
 * @param str - The base64url encoded string to decode.
 * @returns The decoded string.
 */
function base64UrlDecode(str: string): string {
  // Replace '-' with '+' and '_' with '/'
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad the base64 string
  const padding = base64.length % 4;
  if (padding !== 0) {
    base64 += "=".repeat(4 - padding);
  }
  return Base64.decode(base64);
}

/**
 * Validates if the provided token is a valid JWT.
 * @param token - The token to validate.
 * @returns True if valid, false otherwise.
 */
function isValidJWT(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return typeof header === "object" && typeof payload === "object";
  } catch (error) {
    return false;
  }
}

// Singleton instance of Chirpier
let chirpierInstance: Chirpier | null = null;

/**
 * Initializes the Chirpier SDK.
 * @param options - Configuration options for the SDK.
 */
export function initialize(options: Options): void {
  if (!isValidJWT(options.key)) {
    throw new ChirpierError("Invalid API key: Not a valid JWT");
  }

  try {
    chirpierInstance = new Chirpier(options);
  } catch (error) {
    if (error instanceof ChirpierError) {
      console.error("Failed to initialize Chirpier SDK:", error.message);
    } else {
      console.error(
        "An unexpected error occurred during Chirpier SDK initialization:",
        error
      );
    }
    throw error;
  }
}

/**
 * Monitors an event using the Chirpier SDK.
 * @param event - The event to monitor.
 */
export function monitor(event: Event): void {
  if (!chirpierInstance) {
    throw new ChirpierError(
      "Chirpier SDK is not initialized. Please call initialize() first."
    );
  }
  chirpierInstance.monitor(event).catch((error) => {
    console.error("Error in monitor function:", error);
  });
}
