import type { ArtifactImporter } from '../artifacts/artifact-import.ts';
import type { Artifacts } from '../artifacts/artifacts.ts';
import type { Dispatcher } from '../dispatcher.ts';

/* A client connection is always a person. None of these is on a peer's list; what another machine reads is `handlers/peer-artifacts.ts`. */
export function registerArtifactHandlers(dispatcher: Dispatcher, artifacts: Artifacts, importer: ArtifactImporter): void {
    dispatcher.register('artifact.importFrom', (payload) => importer.importFrom(payload));

    dispatcher.register('artifact.list', async (payload) => ({ artifacts: await artifacts.list(payload) }));

    dispatcher.register('artifact.get', ({ artifactId }) => artifacts.get(artifactId));

    dispatcher.register('artifact.watch', (_payload, client) => {
        // A channel that went while this was on its way would leave a watch nobody hears.
        if (client.closed !== true) {
            artifacts.watch(client.id);
        }
        return {};
    });

    dispatcher.register('artifact.unwatch', (_payload, client) => {
        artifacts.unwatch(client.id);
        return {};
    });

    dispatcher.register('artifact.save', (payload) => artifacts.save(payload));

    dispatcher.register('artifact.saveFolder', (payload) => artifacts.saveFolder(payload));

    dispatcher.register('artifact.copyToProject', async (payload) => ({ paths: await artifacts.copyToProject(payload) }));

    dispatcher.register('artifact.storage', () => artifacts.storage());

    dispatcher.register('artifact.cleanup', async (payload) => {
        if (payload.mode === 'preview') {
            return { proposals: artifacts.cleanupPreview() };
        }
        return artifacts.cleanupConfirm(payload.versions);
    });

    dispatcher.register('artifact.remove', (payload) => artifacts.remove(payload));
}
