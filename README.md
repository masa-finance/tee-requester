# TEE Twitter Requester

This repository contains two TEE (Trusted Execution Environment) clients:

1. A Node.js client (original implementation)
2. A Python client (AI trending search implementation)

## Configuration

All configuration is done through environment variables in the `.env` file:

```
# Worker URLs - comma separated if multiple
WORKER_URLS=https://20.254.69.139:8080

# Only used by the Node.js client
ALLOW_INSECURE_TLS=true

# Twitter query configuration
TWITTER_QUERIES="elonmusk"
MAX_RESULTS=100

# Time between requests in seconds
CADENCES=5
```

## Docker Usage

1. Configure environment:

   ```
   cp .env.example .env
   ```

   Edit `.env` with your worker URLs

2. Run both clients with Docker:

   ```
   docker compose up --build
   ```

3. Run only the Python client:

   ```
   docker compose up --build python
   ```

4. Run in background:

   ```
   docker compose up --build -d
   ```

5. View logs:

   ```
   docker compose logs -f
   ```

6. Stop:
   ```
   docker compose down
   ```

## Python Client Features

The Python client:

- Connects to worker URLs specified in the .env file
- Automatically searches for "#AI trending" on Twitter
- Uses a fixed request limit of 22 results per query
- Runs continuous Twitter queries with a 5-second delay between rounds
- Reports detailed statistics on success/failure rates when stopped with Ctrl+C
