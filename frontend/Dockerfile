FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
# npm ci on Alpine/musl skips platform-specific optional deps recorded in a
# macOS-generated lockfile (npm bug #4828). Deleting the lockfile and using
# npm install lets npm correctly resolve native bindings for the target platform.
RUN rm -f package-lock.json && npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
