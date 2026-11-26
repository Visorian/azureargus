ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS bun

FROM node:26-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS build

WORKDIR /app

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ARG VERSION_NUMBER
ARG VCS_REF
RUN test -n "$VERSION_NUMBER"
ENV VERSION_NUMBER=$VERSION_NUMBER
ENV VCS_REF=$VCS_REF

RUN bun run geoip:update
RUN bun run build

FROM node:26-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS runtime

WORKDIR /app

ARG VERSION_NUMBER
ARG VCS_REF

LABEL org.opencontainers.image.source="https://github.com/Visorian/azureargus" \
  org.opencontainers.image.revision="$VCS_REF" \
  org.opencontainers.image.version="$VERSION_NUMBER" \
  org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  NUXT_IP_COUNTRY_DATABASE_PATH=/app/data/dbip-country-lite.mmdb

COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node --chmod=0444 /app/.data/dbip-country-lite.mmdb ./data/dbip-country-lite.mmdb
COPY --chown=node:node --chmod=0444 LICENSE THIRD_PARTY_NOTICES.md ./

USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
