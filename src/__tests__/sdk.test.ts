import { Chirpier, ChirpierError, Event, initialize, monitor } from "../index";
import { DEFAULT_API_ENDPOINT, DEFAULT_RETRIES } from "../constants";
import MockAdapter from "axios-mock-adapter";
import axios from "axios";
import { cleanupMockServer } from "./mocks/server";
import { v4 as uuidv4 } from "@lukeed/uuid";

jest.mock("@lukeed/uuid");

describe("Chirpier SDK", () => {
  let chirpier: Chirpier;

  afterEach(() => {
    // Clean up mock server
    cleanupMockServer();
  });

  describe("Initialization", () => {
    test("should initialize with default values", () => {
      chirpier = new Chirpier({
        key: "api_key",
      });

      // Setup mock server
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      expect(chirpier["apiEndpoint"]).toBe(DEFAULT_API_ENDPOINT);
      expect(chirpier["retries"]).toBe(DEFAULT_RETRIES);
    });

    test("should initialize with custom values using mock server", () => {
      chirpier = new Chirpier({
        key: "api_key",
      });

      // Setup mock server
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      const customChirpier = new Chirpier({
        key: "api_key",
        apiEndpoint: DEFAULT_API_ENDPOINT,
        retries: 5,
      });

      expect(customChirpier["apiEndpoint"]).toBe(DEFAULT_API_ENDPOINT);
      expect(customChirpier["retries"]).toBe(5);
    });

    test("should throw error if key is not provided", () => {
      chirpier = new Chirpier({
        key: "api_key",
      });

      // Setup mock server
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      expect(() => new Chirpier({} as any)).toThrow(ChirpierError);
    });

    test("should throw error if key is not a valid JWT", () => {
      expect(() => initialize({ key: "invalid_key" })).toThrow(ChirpierError);
    });

    test("should initialize successfully with a valid JWT", () => {
      const validJWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      expect(() => initialize({ key: validJWT })).not.toThrow();
    });
  });

  describe("monitor", () => {
    test("event should be sent", async () => {
      chirpier = new Chirpier({
        key: "api_key",
      });

      // Setup mock server
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      const validJWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      initialize({ key: validJWT });
  
      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream: "test-stream",
        value: 1,
      };

      await chirpier.monitor(event);

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(mock.history.post[0].url).toBe(DEFAULT_API_ENDPOINT);
      expect(JSON.parse(mock.history.post[0].data)).toEqual([
        {
          group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
          stream: "test-stream",
          value: 1,
        },
      ]);

      // Clean up the mock
      mock.reset();
    });

    test("should throw error for invalid event", async () => {
      chirpier = new Chirpier({
        key: "api_key",
      });
      const invalidEvent = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
      } as any;
      await expect(chirpier.monitor(invalidEvent)).rejects.toThrow(
        ChirpierError
      );

      // Clean up the mock
      const mock = new MockAdapter(axios);
      mock.reset();
    });

    test("should batch events and flush when batch size is reached", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      const validJWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      initialize({ key: validJWT, batchSize: 2 });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream: "test-stream",
        value: 1,
      };

      monitor(event);
      monitor(event);

      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data).length).toBe(2);

      mock.reset();
    });

    test("should flush events after interval", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      const validJWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      initialize({ key: validJWT, flushInterval: 100 });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream: "test-stream",
        value: 1,
      };

      monitor(event);

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data).length).toBe(1);

      mock.reset();
    });

    test("should use provided event_id if available", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      const validJWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      initialize({ key: validJWT });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream: "test-stream",
        value: 1,
        event_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
      };

      monitor(event);

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data)[0].event_id).toBe("f3438ee9-b964-48aa-b938-a803df440a3c");

      mock.reset();
    });

    test("should generate event_id if not provided", async () => {
      const mock = new MockAdapter(axios);
      mock.onPost(DEFAULT_API_ENDPOINT).reply(200, { success: true });

      (uuidv4 as jest.Mock).mockReturnValue("generated-uuid");

      const validJWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      initialize({ key: validJWT });

      const event: Event = {
        group_id: "f3438ee9-b964-48aa-b938-a803df440a3c",
        stream: "test-stream",
        value: 1,
      };

      monitor(event);

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for flush

      expect(mock.history.post.length).toBe(1);
      expect(JSON.parse(mock.history.post[0].data)[0].event_id).toBe("generated-uuid");

      mock.reset();
    });
  });
});