# The office, built once and served as two images from one build.
#
# One build stage, because the app and the server come from the same workspace
# and share the same packages — building them twice would install the same
# dependencies twice to produce the same output. Two runtime stages, because
# they are genuinely two things: a Node process holding presence, and a pile of
# static files.

FROM node:22-alpine AS build
WORKDIR /src

# Manifests first, so a change to source code does not invalidate the install
# layer. This is the difference between a ten-second rebuild and a two-minute one.
COPY package.json package-lock.json ./
COPY packages/template/package.json packages/template/
COPY packages/presence-store/package.json packages/presence-store/
COPY packages/adapters/package.json packages/adapters/
COPY packages/realtime-core/package.json packages/realtime-core/
COPY packages/realtime-client/package.json packages/realtime-client/
COPY packages/ui-map/package.json packages/ui-map/
COPY packages/ui-builder/package.json packages/ui-builder/
COPY tools/eslint-plugin-ofiskit/package.json tools/eslint-plugin-ofiskit/
COPY server/package.json server/
COPY app/package.json app/

RUN npm ci

COPY . .

RUN npm run build:packages \
  && npm run build --workspace ofiskit-server \
  && npm run build --workspace ofiskit-app

# ---------------------------------------------------------------- the server

FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production

# Only what runs: the engine and its dependencies, the built server, and the
# office itself.
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/packages ./packages
COPY --from=build /src/server/dist ./server/dist
COPY --from=build /src/server/package.json ./server/package.json
COPY --from=build /src/config ./config

ENV CONFIG_DIR=/app/config
ENV PORT=4000

# Not root. Nothing here needs to be.
USER node
EXPOSE 4000

# One request, no shell, no dependencies: if the office answers, it is up.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]

# ------------------------------------------------------------------- the app

FROM nginx:1.27-alpine AS app

# Static files and a reverse proxy, which is all the app needs. The server is a
# separate container, so nginx forwards the socket and the office's own
# endpoints to it and serves everything else from disk.
COPY --from=build /src/app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
