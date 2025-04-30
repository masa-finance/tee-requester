# TEE Twitter Requester

## Docker Usage

1. Configure environment:

   ```
   cp .env.example .env
   ```

   Edit `.env` with your settings

2. Run with Docker:

   ```
   docker compose up --build
   ```

3. Run in background:

   ```
   docker compose up --build -d
   ```

4. View logs:

   ```
   docker compose logs -f
   ```

5. Stop:
   ```
   docker compose down
   ```
