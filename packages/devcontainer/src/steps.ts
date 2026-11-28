import type { Devcontainer } from './devcontainer.ts';
import { sha256, type ContainerNames } from './names.ts';
import type { MachineOrigin } from './origin.ts';
import type { Spawn, Start, Step } from './spawn.ts';

/* Where the container has Ruimte for Linux, read only, from this computer. */
export const MACHINE_FOLDER = '/opt/ruimte';
/* Where the machine's volume is, with its home in it. */
export const STATE_FOLDER = '/var/lib/ruimte';
/* Where the volume of the agent CLIs' sign-ins is. */
export const LOGIN_FOLDER = '/var/lib/ruimte-logins';
/* The label that holds what a container was made from, so one made from something else is made again. */
export const MADE_FROM_LABEL = 'app.ruimte.devcontainer';

// The container's own layer, so a container that was made again runs the command again.
const CREATED_MARK = '/var/lib/ruimte-container/post-create';
// Each CLI is told where its folder is, since the home of the container's user differs per image.
const LOGIN_FOLDERS: Record<string, string> = {
    CLAUDE_CONFIG_DIR: `${LOGIN_FOLDER}/claude`,
    CODEX_HOME: `${LOGIN_FOLDER}/codex`,
    GROK_HOME: `${LOGIN_FOLDER}/grok`,
    GEMINI_HOME: `${LOGIN_FOLDER}/gemini`
};

const PULL = 'docker image inspect "$0" >/dev/null 2>&1 || exec docker pull "$0"';
// Keeps a container that was made from the same description, and makes any other again: its state is in the volumes.
const CREATE = [
    `if [ "$(docker container inspect -f '{{ index .Config.Labels "${MADE_FROM_LABEL}" }}' "$0" 2>/dev/null)" = "$1" ]; then exit 0; fi`,
    'docker rm -f "$0" >/dev/null 2>&1',
    'shift',
    'exec docker "$@"'
].join('\n');
// The container only has to stay up: the machine and every command come in through `docker exec`.
const STAY_UP = 'while sleep 1000; do :; done';
// As root. Without a user named, the folders go to the user the container runs as.
const PREPARE = [
    'set -e',
    'owner=${1:-$(stat -c %u /proc/1)}',
    `mkdir -p ${STATE_FOLDER}/home ${Object.values(LOGIN_FOLDERS).join(' ')} ${CREATED_MARK.slice(0, CREATED_MARK.lastIndexOf('/'))} /usr/local/bin`,
    `chown -R "$owner" ${STATE_FOLDER} ${LOGIN_FOLDER} ${CREATED_MARK.slice(0, CREATED_MARK.lastIndexOf('/'))}`,
    `ln -sf ${MACHINE_FOLDER}/ruimte /usr/local/bin/ruimte`
].join('\n');
const POST_CREATE = '[ -e "$0" ] || { "$@" && : > "$0"; }';
// A machine that runs already holds the port, so a second one ends by itself and changes nothing.
const RUN_MACHINE = `exec ruimte --no-lan --direct-ports "$0" --direct-host-address 127.0.0.1 >>${STATE_FOLDER}/machine.log 2>&1`;

function docker(...args: string[]): Spawn {
    return { command: 'docker', args };
}

function sh(script: string, ...args: string[]): Spawn {
    return { command: 'sh', args: ['-c', script, ...args] };
}

function imageStep(devcontainer: Devcontainer, names: ContainerNames): Step {
    const { build, image } = devcontainer;

    if (build === null) {
        return { title: `Pull ${image ?? ''}, unless it is here already`, spawn: sh(PULL, image ?? '') };
    }

    return {
        title: `Build the image from ${build.dockerfile}`,
        spawn: docker(
            'build',
            '--tag',
            names.image,
            '--file',
            build.dockerfile,
            ...Object.entries(build.args).flatMap(([name, value]) => ['--build-arg', `${name}=${value}`]),
            build.context
        )
    };
}

function createArgs(devcontainer: Devcontainer, names: ContainerNames, origin: MachineOrigin, label: string): string[] {
    const { first, last } = names.ports;
    const env = { ...devcontainer.containerEnv, RUIMTE_HOME: `${STATE_FOLDER}/home`, RUIMTE_LABEL: label, ...LOGIN_FOLDERS };

    return [
        '--init',
        '--workdir',
        devcontainer.workspaceFolder,
        '--mount',
        devcontainer.workspaceMount,
        '--mount',
        `type=volume,source=${names.machineVolume},target=${STATE_FOLDER}`,
        '--mount',
        `type=volume,source=${names.loginVolume},target=${LOGIN_FOLDER}`,
        '--mount',
        `type=bind,source=${origin.folder},target=${MACHINE_FOLDER},readonly`,
        ...devcontainer.mounts.flatMap((mount) => ['--mount', mount]),
        // On this computer alone, and under the same numbers, since the machine announces the ports it binds itself.
        '--publish',
        `127.0.0.1:${first}-${last}:${first}-${last}/udp`,
        ...devcontainer.forwardPorts.flatMap((port) => ['--publish', `127.0.0.1:${port}:${port}`]),
        ...Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
        '--entrypoint',
        '/bin/sh',
        devcontainer.build === null ? (devcontainer.image ?? '') : names.image,
        '-c',
        STAY_UP
    ];
}

export interface StartParts {
    devcontainer: Devcontainer;
    names: ContainerNames;
    origin: MachineOrigin;
    /* What the machine in the container calls itself. */
    label: string;
    /* The digest of the files that decide what runs. */
    fingerprint: string;
}

/*
 * The programs that bring up the container of a devcontainer.json with a machine of Ruimte in it, for Ruimte to run.
 * Every one can run again: an image that is there is not pulled, a container made from the same description is kept,
 * and a machine that runs keeps running. So a second start of a project comes back as the same machine.
 */
export async function describeStart({ devcontainer, names, origin, label, fingerprint }: StartParts): Promise<Start> {
    const { container } = names;
    const as = devcontainer.remoteUser === null ? [] : ['--user', devcontainer.remoteUser];
    const create = createArgs(devcontainer, names, origin, label);
    const madeFrom = (await sha256(JSON.stringify([create, fingerprint]))).slice(0, 32);
    const command = devcontainer.postCreateCommand;

    return {
        steps: [
            ...(origin.step === null ? [] : [origin.step]),
            imageStep(devcontainer, names),
            {
                title: `Create the container ${container}, unless it is there as described`,
                spawn: sh(CREATE, container, madeFrom, 'create', '--name', container, '--label', `${MADE_FROM_LABEL}=${madeFrom}`, ...create)
            },
            { title: 'Start the container', spawn: docker('start', container) },
            {
                title: 'Prepare the container for Ruimte',
                spawn: docker(
                    'exec',
                    '--user',
                    '0',
                    container,
                    'sh',
                    '-c',
                    PREPARE,
                    'sh',
                    ...(devcontainer.remoteUser === null ? [] : [devcontainer.remoteUser])
                )
            },
            ...(command === null
                ? []
                : [
                      {
                          title: 'Run postCreateCommand, once per container',
                          spawn: docker(
                              'exec',
                              ...as,
                              container,
                              'sh',
                              '-c',
                              POST_CREATE,
                              CREATED_MARK,
                              ...(typeof command === 'string' ? ['sh', '-c', command] : command)
                          )
                      }
                  ]),
            { title: 'Check that Ruimte runs in the container', spawn: docker('exec', ...as, container, 'ruimte', '--version') },
            {
                title: 'Start Ruimte in the container',
                spawn: docker(
                    'exec',
                    '--detach',
                    ...as,
                    // Without a value, so the engine hands on the broker Ruimte gave this program.
                    '--env',
                    'RUIMTE_BROKER_URL',
                    '--env',
                    'RUIMTE_BROKER_ADVERTISE_URL',
                    container,
                    'sh',
                    '-c',
                    RUN_MACHINE,
                    `${names.ports.first}-${names.ports.last}`
                )
            }
        ],
        inside: docker('exec', ...as, container),
        fingerprint
    };
}
