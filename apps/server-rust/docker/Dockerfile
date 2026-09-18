FROM rust:1.98.1-bookworm@sha256:9a73a5088750b4c95158ab26629c854c3d6fc4b173cb7bc8079ad252d8ed7bfa AS build

ARG RUIMTE_DOCKER_PROFILE=release
ARG CARGO_BUILD_JOBS=1
WORKDIR /workspace
ENV CARGO_TARGET_DIR=/target
ENV CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/server-rust/Cargo.toml ./apps/server-rust/Cargo.toml
COPY apps/server-rust/src ./apps/server-rust/src
COPY apps/server-rust/schema ./apps/server-rust/schema
COPY apps/server-rust/vendor ./apps/server-rust/vendor

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/target,sharing=locked \
    set -eu; \
    mkdir -p /out; \
    case "$RUIMTE_DOCKER_PROFILE" in \
        debug) \
            cargo build --locked -p ruimte_server --bin ruimte-server -p ruimte_cli --bin ruimte-context; \
            output=/target/debug \
            ;; \
        release) \
            cargo build --locked --release -p ruimte_server --bin ruimte-server -p ruimte_cli --bin ruimte-context; \
            output=/target/release \
            ;; \
        *) \
            echo "Unknown RUIMTE_DOCKER_PROFILE: $RUIMTE_DOCKER_PROFILE" >&2; \
            exit 2 \
            ;; \
    esac; \
    cp "$output/ruimte-server" "$output/ruimte-context" /out/

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git procps ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global user.name 'Ruimte Remote' \
    && git config --global user.email 'remote@ruimte.test' \
    && git config --global init.defaultBranch main \
    && git config --global --add safe.directory '*'

COPY --from=build /out/ruimte-server /usr/local/bin/ruimte-server
COPY --from=build /out/ruimte-context /usr/local/bin/ruimte-context
COPY apps/server-rust/docker/entrypoint.sh /usr/local/bin/ruimte-entrypoint
RUN chmod +x /usr/local/bin/ruimte-entrypoint

ENV RUIMTE_HOME=/root/.ruimte
ENV RUIMTE_PORT=4310
EXPOSE 4310

ENTRYPOINT ["/usr/local/bin/ruimte-entrypoint"]
