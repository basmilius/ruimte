# A second Ruimte daemon, on Linux, so a client on macOS can pair with a machine that is not its
# own. Build from the repository root: `docker compose -f apps/server/docker/compose.yml build`.
FROM oven/bun:1.4.0-debian

# git for `git.status` and the seeded repositories, procps so a test can see the shell's children.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git procps \
    && rm -rf /var/lib/apt/lists/*

# The seeded repositories commit as somebody; git refuses to commit without a name.
RUN git config --global user.name 'Ruimte Remote' \
    && git config --global user.email 'remote@ruimte.test' \
    && git config --global init.defaultBranch main \
    && git config --global --add safe.directory '*'

WORKDIR /app

# The image runs the daemon and nothing else, so it installs a workspace without the client and
# the desktop shell; vite and electron would otherwise dominate the image and every rebuild.
COPY apps/server/docker/workspace-package.json ./package.json
COPY bun.lock ./bun.lock
COPY apps/server/package.json ./apps/server/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/drawing/package.json ./packages/drawing/package.json
COPY packages/diagram/package.json ./packages/diagram/package.json
RUN bun install

COPY packages/contracts/src ./packages/contracts/src
COPY packages/drawing/src ./packages/drawing/src
COPY packages/diagram/src ./packages/diagram/src
COPY apps/server/src ./apps/server/src
COPY apps/server/bin ./apps/server/bin
COPY apps/server/docker/entrypoint.sh /usr/local/bin/ruimte-entrypoint
RUN chmod +x /usr/local/bin/ruimte-entrypoint

ENV RUIMTE_HOME=/root/.ruimte
ENV RUIMTE_PORT=4310
EXPOSE 4310

ENTRYPOINT ["/usr/local/bin/ruimte-entrypoint"]
