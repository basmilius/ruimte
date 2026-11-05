import type { ArchiveExtractResult } from '@ruimte/contracts';
import { listArchive } from '../archive/archive.ts';
import { planExtract } from '../archive/extract.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { WriteBoundary } from '../fs/write.ts';
import type { FileMove, LanguageHost } from '../language/host.ts';

/* An archive is read where `fs.read` reads and unpacked where `fs.create` makes files. */
export function registerArchiveHandlers(
    dispatcher: Dispatcher,
    boundaryOf: (clientId: string) => Promise<WriteBoundary>,
    machineHome: MachineHome,
    language?: Pick<LanguageHost, 'createFiles'>
): void {
    dispatcher.register('archive.list', async (payload) => {
        await machineHome.refuse(payload.path);
        return listArchive(payload.path);
    });

    dispatcher.register('archive.extract', async (payload, client) => {
        await Promise.all([machineHome.refuse(payload.path), machineHome.refuse(payload.to)]);
        const plan = await planExtract(payload, await boundaryOf(client.id));
        if (payload.projectId === undefined || language === undefined) {
            return plan.run();
        }
        let result: ArchiveExtractResult | undefined;
        // The servers hear of the folder once it is made and are asked for no edits, so only `move` is ever called.
        const unused = async (): Promise<void> => undefined;
        const host: FileMove = {
            write: unused,
            create: unused,
            rename: unused,
            delete: unused,
            move: async () => {
                result = await plan.run();
            }
        };
        await language.createFiles(client.id, payload.projectId, plan.to, true, false, host);
        return result!;
    });
}
