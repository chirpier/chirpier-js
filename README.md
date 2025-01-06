# Chirpier SDK

The Chirpier SDK for JavaScript is a simple, lightweight, and efficient SDK to emit event data to Chirpier direct from your JavaScript applications.

## Features

- Easy-to-use API for sending events to Chirpier
- Automatic batching of events for improved performance
- Automatic retry mechanism with exponential backoff
- Thread-safe operations
- Periodic flushing of the event queue
- Environment Agnostic: Works seamlessly in both browser and Node.js environments.

## Installation

Install Chirpier SDK using npm:

``` bash
npm install @chirpier/chirpier-js
```

## Getting Started

### Initializing the SDK

To start using the SDK, you need to initialize it with your API key. The SDK works in both browser and Node.js environments.

Here's a quick example of how to use the Chirpier SDK:

#### In a Browser

```js
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

```js
const express = require('express');
const { initialize, monitor, Event } = require('@chirpier/chirpier-js');

const app = express();
const port = 3000;

// Initialize the SDK with your API key
initialize({ key: 'your-api-key', region: 'us-west' });

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

### Usage

```js
// Initialize the SDK with your API key
initialize({ key: 'your-api-key', region: 'us-west' });

// Monitor an event
monitor({
  group_id: '02e4f4d8-415e-4fc1-b01a-677ac5bc9207',
  stream_name: 'My measurement',
  value: 15.3,
});
```

## API Reference

### Initialize

Initialize the Chirpier client with your API key and region. Find your API key in the Chirpier Integration page.

```js
initialize({ key: 'your-api-key', region: 'region' });
```

- `your-api-key` (str): Your Chirpier integration key
- `region` (str): Your local region - options are `us-west`, `eu-west`, `asia-southeast`

### Event

All events emitted to Chirpier must have the following properties:

```js
event = {
  group_id: '02e4f4d8-415e-4fc1-b01a-677ac5bc9207',
  stream_name: 'My measurement',
  value: 15.3,
};
```

- `group_id` (str): UUID of the monitoring group
- `stream_name` (str): Name of the measurement stream
- `value` (float): Numeric value to record

### Monitor

Send an event to Chirpier using the `monitor` function.

```js
monitor(event);
```

## Test

Run the test suite to ensure everything works as expected:

```bash
npx jest
```

## Contributing

We welcome contributions! To contribute:

1. Fork this repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request with a clear explanation of your changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any problems or have any questions, please open an issue on the GitHub repository or contact us at <contact@chirpier.co>.

---

Start tracking your events seamlessly with Chirpier SDK!
