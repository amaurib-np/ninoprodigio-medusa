# Self-host fallback image (Railway/Coolify). Primary target is Medusa Cloud
# (push-to-deploy from GitHub), which builds from source and does NOT use this file.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.medusa/server ./.medusa/server
COPY package.json ./
WORKDIR /app/.medusa/server
RUN npm install --omit=dev

EXPOSE 9000
# Runs DB migrations then starts the server. Set MEDUSA_WORKER_MODE per instance.
CMD ["sh", "-c", "npx medusa db:migrate && npx medusa start"]
