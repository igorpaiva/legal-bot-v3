# Multi-stage build for production optimization
# Use Node.js 20 Alpine as base image (newer version for better compatibility)
FROM node:20-alpine AS builder

# Install build dependencies including Python and build tools
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    build-base \
    sqlite-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Create production image
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    sqlite \
    curl \
    bash

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy package files
COPY package*.json ./

# Copy application code selectively
COPY server.js ./
COPY routes/ ./routes/
COPY services/ ./services/
COPY models/ ./models/
COPY middleware/ ./middleware/
COPY utils/ ./utils/
COPY database/ ./database/
COPY scripts/ ./scripts/

# Create necessary directories
RUN mkdir -p data sessions backups logs uploads && \
    chown -R nextjs:nodejs /app

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/api/monitoring/health || exit 1

# Switch to non-root user
USER nextjs

# Start the application
CMD ["npm", "start"]
