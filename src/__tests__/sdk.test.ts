import { Chirpier, ChirpierError, Event, initialize, monitor } from "../index";
import {
  DEFAULT_API_ENDPOINT,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FLUSH_DELAY,
} from "../constants";
import MockAdapter from "axios-mock-adapter";
import axios from "axios";

describe("Chirpier SDK", () => {
  describe("Initialization", () => {
    test("should throw error if monitor is called before initialize", () => {
      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream_name: "test-stream",
        value: 1,
      };

      expect(() => monitor(event)).toThrow(ChirpierError);
      expect(() => monitor(event)).toThrow(
        "Chirpier SDK is not initialized. Please call initialize() first."
      );
    });

    test("should initialize with default values", () => {
      initialize({
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      });
      const chirpier = Chirpier.getInstance({} as any);

      // Setup mock server
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      expect(chirpier?.["apiEndpoint"]).toBe(DEFAULT_API_ENDPOINT);
      expect(chirpier?.["retries"]).toBe(DEFAULT_RETRIES);
      expect(chirpier?.["timeout"]).toBe(DEFAULT_TIMEOUT);
      expect(chirpier?.["batchSize"]).toBe(DEFAULT_BATCH_SIZE);
      expect(chirpier?.["flushTimeout"]).toBe(DEFAULT_FLUSH_DELAY);

      Chirpier.stop();
    });

    test("should throw error if key is not provided", () => {
      expect(() => {
        initialize({
          key: "api_key",
        });
      }).toThrow(ChirpierError);
      expect(() => {
        initialize({
          key: "api_key",
        });
      }).toThrow("Invalid API key: Not a valid JWT");
    });
  });

  describe("monitor", () => {
    test("event should be sent", async () => {
      // Setup mock server
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream_name: "test-stream",
        value: 1,
      };

      monitor(event);

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(mock.history.post[0].url).toBe(DEFAULT_API_ENDPOINT);
      expect(JSON.parse(mock.history.post[0].data)).toEqual([
        {
          group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
          stream_name: "test-stream",
          value: 1,
        },
      ]);

      // Clean up the mock
      mock.reset();
      Chirpier.stop();
    });

    test("should throw error for invalid event", async () => {
      initialize({
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      });
      const chirpier = Chirpier.getInstance({} as any);

      const invalidEvent = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
      } as any;
      await expect(chirpier?.monitor(invalidEvent)).rejects.toThrow(
        ChirpierError
      );

      // Clean up the mock
      Chirpier.stop();
    });

    test("should batch events and flush when batch size is reached", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream_name: "test-stream",
        value: 1,
      };

      monitor(event);
      monitor(event);

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data).length).toBe(2);

      mock.reset();
      Chirpier.stop();
    });

    test("should flush events after interval", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      initialize({
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream_name: "test-stream",
        value: 1,
      };

      monitor(event);

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data).length).toBe(1);

      mock.reset();
      Chirpier.stop();
    });
  });
});
