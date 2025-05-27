FROM node:20-alpine

WORKDIR /app

# Copy package.json and yarn.lock first for better layer caching
COPY package*.json yarn.lock ./

# Install all dependencies
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the app
RUN npm run build

# Set environment variables (these can be overridden when running the container)
ENV NODE_ENV=production

# Create a simple entrypoint script
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'if [ "$1" = "indexer" ]; then' >> /app/entrypoint.sh && \
    echo '  shift' >> /app/entrypoint.sh && \
    echo '  exec node dist/indexer.js "$@"' >> /app/entrypoint.sh && \
    echo 'elif [ "$1" = "worker" ]; then' >> /app/entrypoint.sh && \
    echo '  shift' >> /app/entrypoint.sh && \
    echo '  exec node dist/index.js "$@"' >> /app/entrypoint.sh && \
    echo 'else' >> /app/entrypoint.sh && \
    echo '  exec node dist/index.js "$@"' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]

# Default to running the worker client (backward compatibility)
CMD ["worker"] 