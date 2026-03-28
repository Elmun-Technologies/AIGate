# Multi-stage build: development and production targets
FROM node:20-alpine AS base

WORKDIR /app
EXPOSE 3000

# Development stage (with hot-reload and debugging)
FROM base AS development

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev"]

# Build stage (compiles Next.js)
FROM base AS builder

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage (optimized, minimal)
FROM base AS production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/public /app/public
COPY --from=builder /app/next.config.js /app/next.config.js
COPY --from=builder /app/tsconfig.json /app/tsconfig.json

CMD ["npm", "start"]
