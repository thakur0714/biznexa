# Build from the repository root:  docker build -f apps/api/Dockerfile -t biznexa-api .
FROM node:22-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/types/package.json packages/types/
COPY packages/rich-text/package.json packages/rich-text/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @biznexa/api...
COPY packages/types packages/types
COPY packages/rich-text packages/rich-text
COPY apps/api apps/api
RUN pnpm --filter @biznexa/types build && pnpm --filter @biznexa/rich-text build && pnpm --filter @biznexa/api build
RUN pnpm deploy --filter @biznexa/api --prod --legacy /out && cp -r apps/api/dist /out/dist && cp -r apps/api/prisma /out/prisma && cp apps/api/prisma.config.ts /out/

FROM base AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# Private uploads (D17): mount the shared, backed-up volume here.
ENV UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown node:node /data/uploads
VOLUME /data/uploads
# Public website images (M9.4): a separate volume, never inside /data/uploads.
ENV MEDIA_DIR=/data/media
RUN mkdir -p /data/media && chown node:node /data/media
VOLUME /data/media
# Headless Chromium for PDFs (M3.22, PDF_RENDERER=playwright): the version playwright-core expects, with its
# system libraries; shared so the node user can start it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run migrations as a separate release step: npx prisma migrate deploy
CMD ["node", "dist/main.js"]
