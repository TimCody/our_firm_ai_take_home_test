# Multi-stage build: install once, build both workspaces, then ship a slim runtime.
FROM node:20-alpine AS builder
WORKDIR /app
# sharp + @napi-rs/canvas need a few build deps on alpine
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* tsconfig.base.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/backend/package.json backend/
COPY --from=builder /app/frontend/package.json frontend/
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/frontend/dist frontend/dist
# The frontend's static assets are served by any CDN/nginx; for a one-shot
# container deploy you'd add a `serve frontend/dist` step or front it with
# nginx. For the take-home, the backend is the long-running process.
EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
