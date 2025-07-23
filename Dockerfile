# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app

# Install dependencies (use npm ci for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript (output to dist)
RUN npx tsc --project tsconfig.json --outDir dist

# Stage 2: Production
FROM node:18-alpine
WORKDIR /app

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy built code from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Copy any necessary config files (e.g., migrations, entities, etc.)
COPY --from=builder /app/src/migrations ./src/migrations
COPY --from=builder /app/src/entities ./src/entities

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port (can be overridden by env)
EXPOSE $PORT

# Healthcheck (optional, for Docker Compose/Swarm/K8s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/healthcheck || exit 1

# Use non-root user
USER appuser

# Start the app
CMD ["node", "dist/local.js"]
