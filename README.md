# Chirpier SDK

The Chirpier SDK is a lightweight, library for monitoring and tracking streams of data in both browser and server environments. With built-in retry logic, and offline handling, the Chirpier SDK makes it easy to collect and send data to the Chirpier API.

## Features

- Environment Agnostic: Works seamlessly in both browser and Node.js environments.
- Retry Logic: Includes retry mechanisms with exponential backoff for failed requests.
- Offline Support: Queues events when offline and sends them when the connection is restored.
- Easy Integration: Simple API for quick integration into your projects.

## Installation

You can install the Chirpier SDK via npm:

```
npm install @chirpier/chirpier-js
```

## Getting Started

### Initializing the SDK

To start using the SDK, you need to initialize it with your API key. The SDK works in both browser and Node.js environments.

#### In a Browser

```
import { initialize, monitor, Event } from '@chirpier/chirpier-js';

// Initialize the SDK with your API key
initialize({ key: 'your-api-key' });

// Send a data stream tied to a group of streams
monitor({
  group_id: '02e4f4d8-415e-4fc1-b01a-677ac5bc9207',
  stream_name: 'My measurement',
  value: 15.30,
} as Event);
```

#### In a Server (e.g., Express.js)

```
const express = require('express');
const { initialize, monitor, Event } = require('@chirpier/chirpier-js');

const app = express();
const port = 3000;

// Initialize the SDK with your API key
initialize({ key: 'your-api-key' });

app.use(express.json());

app.post('/monitor', (req, res) => {
  const { group_id, stream_name, value } = req.body;

  if (!group_id || !stream_name || !value) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Monitor an event
  monitor({ group_id, stream_name, value } as Event);

  res.status(200).json({ message: 'Event tracked successfully' });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
```

## Example

```
// Initialize the SDK with your API key
initialize({ key: 'your-api-key' });

// Monitor an event
monitor({
  group_id: '02e4f4d8-415e-4fc1-b01a-677ac5bc9207',
  stream_name: 'My measurement',
  value: 15.3,
});
```
