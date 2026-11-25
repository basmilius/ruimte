import type { MachineStep } from '@ruimte/extension/server';

/* Where Ruimte for Linux comes from: the one step that gets it onto this computer, and where it then is. */
export interface MachineOrigin {
    step: MachineStep;
    /* The folder on this computer that holds `ruimte` after the step, which the container gets read only. */
    folder: string;
}

export type LinuxArch = 'arm64' | 'x64';

/*
 * The one place that knows where the machine comes from. From a checkout of Ruimte it is that checkout's own daemon,
 * compiled for Linux on every start so the container runs what is being worked on. A build of Ruimte without a
 * checkout has no origin yet, and answers null.
 */
export function machineOrigin(arch: LinuxArch, checkout: string | undefined): MachineOrigin | null {
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
