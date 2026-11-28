# Dev Containers

A project with a `devcontainer.json` gets a machine of Ruimte inside its container. You start it from Settings, Machines, approve the programs once, and the machine joins your account. The app on this computer then reaches it like any other machine, and your agents and terminals work in Linux, in the project's own image.

It is a machine source (`defineMachineSource`) with only a `server/`, on the public extension API. Machine sources are a proposed part, so it runs as a dev link and cannot be installed yet. `bun dev` links it.

What it reads, the names and the programs are `@ruimte/devcontainer` (`packages/devcontainer`), which `extension pack` bundles into it. The desktop app that runs no machine of its own uses the same package to start a folder's dev container itself, with Docker on the computer it runs on, and puts that machine on the account the app is signed in to (`apps/desktop/CLAUDE.md`). Everything below holds for both, except where the machine comes from.

## What it reads

It looks for `.devcontainer/devcontainer.json`, then `.devcontainer.json`, and lists one place for the first it finds, named after the file's `name` or the project. The file may hold comments and a comma after a last entry.

| Key | What happens with it |
| --- | --- |
| `name` | The title of the place and the name of the machine. |
| `image` | Pulled when it is not on this computer yet. |
| `build.dockerfile`, `build.context`, `build.args` | Built on every start, from the folder the file is in. Docker's cache makes a second build short. |
| `workspaceFolder`, `workspaceMount` | Without them the project folder is mounted at `/workspaces/<folder name>`. |
| `mounts` | As text or as `type`, `source` and `target`. |
| `containerEnv` | Set on the container. |
| `remoteUser` | The user the machine and `postCreateCommand` run as. Without it, the user of the image. |
| `forwardPorts` | Port numbers, published on `127.0.0.1` under the same number. |
| `postCreateCommand` | One line for a shell, or a program with its arguments. It runs once per container. |

`${localWorkspaceFolder}`, `${localWorkspaceFolderBasename}`, `${containerWorkspaceFolder}` and `${containerWorkspaceFolderBasename}` are filled in.

A file that needs one of these lists as a place that says so, and starts nothing:

- `features`
- `dockerComposeFile`
- `initializeCommand`, `onCreateCommand`, `updateContentCommand`, `postStartCommand`, `postAttachCommand`
- `build.target`
- a `postCreateCommand` that names several commands to run side by side
- any other `${...}` variable, such as `${localEnv:HOME}`
- a `forwardPorts` entry that is no port number
- a mount of the Docker socket, of `~/.ruimte`, or of the folder a CLI keeps its sign-in in (`.claude`, `.codex`, `.grok`, `.gemini`)

Every other key is ignored: `customizations`, `runArgs`, `remoteEnv`, `containerUser`, `overrideCommand` and the rest. The start says which ones, in its lines and in the extension's log (`ruimte extension logs`).

## What a start runs

Dev Containers runs nothing itself. It describes these programs, Ruimte shows them for approval and runs them in order. A changed `devcontainer.json` or Dockerfile asks again.

1. Get Ruimte for Linux onto this computer (see below).
2. `docker pull` the image unless it is here, or `docker build` the Dockerfile.
3. `docker create` the container, unless one made from the same description is there. One made from another description is removed first, with `docker rm -f`.
4. `docker start` it.
5. As root in the container: make the folders of the two volumes, hand them to the user, and link `ruimte` into `/usr/local/bin`.
6. `postCreateCommand`, when the file has one and this container did not run it yet.
7. `ruimte --version` in the container, so an image Ruimte cannot run in fails here with its reason.
8. `ruimte` in the container, detached. Its output goes to `/var/lib/ruimte/machine.log`.

Then Ruimte runs `docker exec <container> ruimte join <your account>` itself. The machine signs its own registration, and your app posts it.

Every program can run again. Dev Containers asks Docker nothing, so it cannot tell whether the container runs and always offers Start. Starting one that runs changes nothing: the machine in it holds its port, and a second one ends by itself.

Steps 3 and 2 use `sh` on this computer, so the host is macOS or Linux.

## What it makes

Names come from the project folder: its own name for you to read, and eight characters of the digest of its whole path, so two folders with one name never share anything.

| What | Name | Holds |
| --- | --- | --- |
| Container | `ruimte-devcontainer-<folder>-<digest>` | The image, with a shell loop as its command. The entrypoint of the image does not run. |
| Volume | `…-machine` at `/var/lib/ruimte` | The machine's home (`RUIMTE_HOME=/var/lib/ruimte/home`): its id and keys, its account, its projects. |
| Volume | `…-logins` at `/var/lib/ruimte-logins` | The sign-ins of Claude Code, Codex, Grok and Antigravity, through `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME` and `GEMINI_HOME`. |
| Image | `ruimte-devcontainer-<folder>-<digest>` | Only for a Dockerfile. |
| Ports | Ten UDP ports between 44000 and 48999, on `127.0.0.1` | A direct connection. The block comes from the same digest. |

The state is in the volumes, so the same project comes back as the same machine, also after the container was made again. Sign in to a CLI once, in a terminal on the new machine. Nothing of this computer is mounted but the project folder and Ruimte for Linux, read only. GitHub Copilot keeps its sign-in in the system's credential store, which a container does not have, so it needs a token in `containerEnv`.

Nothing is stopped or removed for you:

```sh
docker stop ruimte-devcontainer-<folder>-<digest>     # the machine goes offline, everything stays
docker rm ruimte-devcontainer-<folder>-<digest>       # the next start makes it again, as the same machine
docker volume rm ruimte-devcontainer-<folder>-<digest>-machine ruimte-devcontainer-<folder>-<digest>-logins
```

`docker stop` ends the machine without its own shutdown. Removing the machine volume makes the next start a new machine, and the old one stays on your account until you remove it under Settings, Machines.

## How the machine gets in

The origin names where Ruimte for Linux comes from. Everything else only mounts the folder it names at `/opt/ruimte`, read only.

From a checkout, `bun dev` sets `RUIMTE_DEV_CHECKOUT`, and the first step is `bun apps/server/scripts/compile.ts --target linux-<arch>`. That cross-compiles this checkout's daemon into `apps/server/dist/linux-<arch>` on every start, so the container runs the code you are working on. It takes about three seconds on an Apple silicon Mac once Bun has the Linux runtime (the first time it downloads 52 MB), and the folder is 149 MB. The architecture is this computer's.

Without that variable the extension has no origin, and a start says so. The desktop app in machine mode `none` has a second one: outside a checkout it downloads the published `@ruimte/linux-arm64` or `@ruimte/linux-x64` of its own version once, checks it against the `sha512` npm states, and mounts its `bin` folder. A version npm has no package of says so before anything runs.

The binary is Bun's build for glibc. An image on musl, such as Alpine, fails at step 7.

## Reaching it

The machine in the container starts with `--no-lan --direct-ports <block> --direct-host-address 127.0.0.1`. The door on the local network stays closed, since its addresses would be the container's. Ruimte gives every program of a start `RUIMTE_BROKER_URL` and `RUIMTE_BROKER_ADVERTISE_URL` of the machine on this computer, and step 8 hands them on, so the new machine announces itself to the broker your app already uses. The desktop app without a machine has no broker of its own to hand on, so the new machine takes the default, `wss://broker.ruimte.app`. The app signals through that broker and connects over UDP to `127.0.0.1`.

What depends on your setup:

- The container needs to reach the broker. With the default, `wss://broker.ruimte.app`, that is the internet. A broker on this computer's loopback is out of the container's reach.
- A machine on this computer with its broker off starts a machine with its broker off, which nobody reaches.
- The UDP ports are published on `127.0.0.1` only, so the route that is certain is the app on this computer. Whether a phone or another computer gets through depends on the network between it and the container, and nothing here was tried for it.
- Two projects can land on the same block of ports, one chance in 500 per pair, and a forwarded port can be taken. `docker start` then fails with Docker's own message.

## Try it

1. `bun dev`, signed in to your account in Ruimte Dev, with Docker running.
2. Put this in a project as `.devcontainer/devcontainer.json` and open the project:

    ```jsonc
    {
        // Any image with glibc and a shell.
        "name": "Try",
        "image": "debian:bookworm-slim",
        "postCreateCommand": "echo created"
    }
    ```

3. Settings, Machines lists Try under From Dev Containers. Start shows the programs, Approve and start runs them.
4. The machine named Try shows among the machines of your account.

`bun run test` in this folder runs the tests against the test server, without Docker.
