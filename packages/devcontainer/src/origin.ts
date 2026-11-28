import type { Step } from './spawn.ts';

/* Where Ruimte for Linux comes from: the one step that gets it onto this computer, and where it then is. */
export interface MachineOrigin {
    /* Null when whoever runs the start gets it there itself, before the steps described here. */
    step: Step | null;
    /* The folder on this computer that holds `ruimte` after the step, which the container gets read only. */
    folder: string;
}

export type LinuxArch = 'arm64' | 'x64';

/* The architecture of Linux a container runs on this computer, which is the computer's own. */
export function linuxArchOf(arch: string): LinuxArch {
    return arch === 'x64' ? 'x64' : 'arm64';
}

/*
 * The machine from a checkout of Ruimte: that checkout's own daemon, compiled for Linux on every start so the container
 * runs what is being worked on. Null without a checkout.
 */
export function checkoutOrigin(arch: LinuxArch, checkout: string | undefined): MachineOrigin | null {
    if (checkout === undefined || checkout === '') {
        return null;
    }

    return {
        step: {
            title: 'Build Ruimte for Linux from this checkout',
            spawn: { command: 'bun', args: [`${checkout}/apps/server/scripts/compile.ts`, '--target', `linux-${arch}`] }
        },
        folder: `${checkout}/apps/server/dist/linux-${arch}`
    };
}
