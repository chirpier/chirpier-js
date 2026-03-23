// constants.ts

export const DEFAULT_RETRIES = 15 as const;
export const DEFAULT_TIMEOUT = 5000 as const;
export const DEFAULT_BATCH_SIZE = 500 as const;
export const DEFAULT_FLUSH_DELAY = 500 as const;
export const MAX_QUEUE_SIZE = 5000 as const;
export const DEFAULT_API_ENDPOINT = "https://logs.chirpier.co/v1.0/logs" as const;
export const DEFAULT_SERVICER_ENDPOINT = "https://api.chirpier.co/v1.0" as const;