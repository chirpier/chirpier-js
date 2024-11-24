// Import necessary dependencies
import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { Base64 } from "js-base64";
import {
  DEFAULT_API_ENDPOINT,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FLUSH_DELAY,
} from "./constants";

// Define the options interface for Chirpier initialization
interface Options {
  key: string;
}

// Define the Event interface for monitoring
export interface Event {
  group_id: string;
  stream_name: string;
  value: number;
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
  private static instance: Chirpier | null = null;
  private readonly apiKey: string;
  private readonly apiEndpoint: string;
  private readonly retries: number;
  private readonly timeout: number;
  private readonly axiosInstance: AxiosInstance;
  private eventQueue: Event[] = [];
  private readonly batchSize: number;
  private readonly flushTimeout: number;
  private flushTimeoutId: NodeJS.Timeout | null = null;

  /**
   * Initializes a new instance of the Chirpier class.
   * @param options - Configuration options for the SDK.
   */
  private constructor(options: Options) {
    const {
      key,
    } = options;

    if (!key || typeof key !== "string") {
      throw new ChirpierError("API key is required and must be a string");
    }
    
    this.apiKey = key;
    this.apiEndpoint = DEFAULT_API_ENDPOINT;
    this.retries = DEFAULT_RETRIES;
    this.timeout = DEFAULT_TIMEOUT;
    this.batchSize = DEFAULT_BATCH_SIZE;
    this.flushTimeout = DEFAULT_FLUSH_DELAY;

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
   * Gets the singleton instance of Chirpier, creating it if it doesn't exist.
   * @param options - Configuration options for the SDK.
   * @returns The Chirpier instance.
   */
  public static getInstance(options: Options): Chirpier | null {
    if (!Chirpier.instance && options.key) {
      Chirpier.instance = new Chirpier(options);
    }
    return Chirpier.instance;
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
      typeof event.stream_name === "string" &&
      event.stream_name.trim().length > 0 &&
      typeof event.value === "number"
    );
  }

  /**
   * Monitors an event by adding it to the queue and scheduling a flush if necessary.
   * @param event - The event to monitor.
   */
  public async monitor(event: Event): Promise<void> {
    if (!this.isValidEvent(event)) {
      throw new ChirpierError(
        "Invalid event format. Must include group_id, stream_name, and numeric value."
      );
    }

    this.eventQueue.push(event);

    if (this.eventQueue.length >= this.batchSize) {
      console.info(`Batch size reached. Flushing queue.`);
      await this.flushQueue();
    } else if (!this.flushTimeoutId) {
      this.flushTimeoutId = setTimeout(() => this.flushQueue(), this.flushTimeout);
    }
  }

  /**
   * Flushes the event queue by sending all events to the API.
   */
  private async flushQueue(): Promise<void> {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    if (this.eventQueue.length === 0) {
      return;
    }

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.sendEvents(eventsToSend);
      console.info(`Successfully sent ${eventsToSend.length} events`);
    } catch (error) {
      console.error("Failed to send events:", error);
    }
  }

  /**
   * Sends multiple events to the API in a batch.
   * @param events - The array of events to send.
   */
  private async sendEvents(events: Event[]): Promise<void> {
    await this.axiosInstance.post(this.apiEndpoint, events);
  }
  
  // Stop the timeout and uninitialize the Chirpier instance
  public static stop(): void {
    if (!Chirpier.instance) {
      return;
    }
    if (Chirpier.instance.flushTimeoutId) {
      clearTimeout(Chirpier.instance.flushTimeoutId);
      Chirpier.instance.flushTimeoutId = null;
    }
    // Flush any remaining events in the queue
    Chirpier.instance.flushQueue();
    // Uninitialize the Chirpier instance
    Chirpier.instance = null;
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

/**
 * Initializes the Chirpier SDK.
 * @param options - Configuration options for the SDK.
 */
export function initialize(options: Options): void {
  if (!isValidJWT(options.key)) {
    throw new ChirpierError("Invalid API key: Not a valid JWT");
  }

  try {
    Chirpier.getInstance(options);
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
  const instance = Chirpier.getInstance({} as Options);
  if (!instance) {
    throw new ChirpierError(
      "Chirpier SDK is not initialized. Please call initialize() first."
    );
  }
  
  instance.monitor(event).catch((error) => {
    console.error("Error in monitor function:", error);
  });
}
