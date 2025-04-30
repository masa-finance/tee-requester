FROM golang:1.23 AS builder

WORKDIR /app

# Copy dependency files first for better layer caching
COPY go.mod ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application with CGO enabled
RUN CGO_ENABLED=1 GOOS=linux go build -o requester .

# Create a minimal image for running
FROM debian:stable-slim

# Add CA certificates for HTTPS requests
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/requester .

# Make the binary executable
RUN chmod +x ./requester

# Run the application
CMD ["./requester"] 