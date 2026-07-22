FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build

WORKDIR /app

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ARG VERSION_NUMBER
RUN test -n "$VERSION_NUMBER"
ENV VERSION_NUMBER=$VERSION_NUMBER

RUN bun run geoip:update
RUN bun run build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime

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
