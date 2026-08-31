# Runtime-only image: the JavaScript build happens in CI (or on a laptop),
# never on the 1 GB server. This keeps the image small and the box alive.
FROM node:22-alpine3.20

RUN apk add --no-cache postgresql16-client tini

ENV NODE_ENV=production \
    PNPM_HOME=/usr/local/bin
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY dist ./dist
COPY drizzle ./drizzle

RUN mkdir -p /data/backups && chown -R node:node /data /app
USER node

EXPOSE 3000
ENV PORT=3000 \
    BACKUP_DIR=/data/backups \
    NODE_OPTIONS=--max-old-space-size=192

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]
