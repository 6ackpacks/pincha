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

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs

EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
