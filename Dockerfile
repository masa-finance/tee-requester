FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json first for better layer caching
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the app
RUN npm run build

# Set environment variables (these can be overridden when running the container)
ENV NODE_ENV=production

# Run the app
CMD ["node", "dist/index.js"] 