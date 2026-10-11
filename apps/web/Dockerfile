# Build from the repository root:  docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:4000 -t biznexa-web .
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_SITE_URL=https://biznexa.com
ENV API_URL=$API_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/types/package.json packages/types/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @biznexa/web...
COPY packages/types packages/types
COPY apps/web apps/web
RUN pnpm --filter @biznexa/types build && pnpm --filter @biznexa/web build

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo .
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@biznexa/web", "start"]
