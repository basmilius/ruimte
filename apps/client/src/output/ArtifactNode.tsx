import { Button, ErrorBoundary, Icon, IconButton, Menu, Pill } from '@adecore/ui';
import { formatDayClock } from '@adecore/ui/format';
import type { ArtifactGetResult } from '@ruimte/contracts';
import { ChevronDown, CircleAlert, Maximize2, Package, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VersionBody } from '@/output/ArtifactView';
import { openArtifact } from '@/output/open';
import { useArtifact } from '@/output/use-artifact';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { NodeHeaderControls, NodePlate } from '@/surface/nodes/node-chrome';
import { useMachineAnswers } from '@/transport/features';

// A version id is the machine's and never empty, so the empty string is free to mean no version at all.
const FOLLOW_LATEST = '';

/*
 * An artifact of this machine's Output on a canvas. The reference is one person's on one machine and
 * lives in the private overlay, so a teammate's node arrives without it and says so. Without a version
 * the node follows the latest; with one it stays there and says when a newer one exists.
 */
export function ArtifactNodeBody({ id }: { id: string }) {
    const { t } = useTranslation('output');
    const canvas = useCanvasStore();
    const reference = useCanvas((s) => s.nodes[id]?.artifact);
    if (reference === undefined) {
        return (
            <NodePlate icon={Package}>
                <span className="text-text">{t('node.notHere')}</span>
                <span>{t('node.notHereDetail')}</span>
            </NodePlate>
        );
    }
    const pin = (versionId: string | null): void => {
        canvas.getState().updateNode(id, { artifact: { id: reference.id, ...(versionId === null ? {} : { version: versionId }) } }, true);
    };
    return <ArtifactOnCanvas artifactId={reference.id} version={reference.version} onPin={pin} />;
}

interface ArtifactOnCanvasProps {
    artifactId: string;
    version: string | undefined;
    /* How a person picks another version, with null for following the latest; without it the version is set elsewhere and offers no picker. */
    onPin: ((versionId: string | null) => void) | null;
    titled?: boolean;
    note?: string | null;
}

/*
 * An artifact the way a node on the canvas draws it: its version, with the controls in the header slot
 * of the surface around it (`useFileToolbarSlot`). A routine's Output beside its node draws the same.
 */
export function ArtifactOnCanvas(props: ArtifactOnCanvasProps) {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'artifact.get');
    const state = useArtifact(endpointId, props.artifactId, answers);
    if (!answers) {
        return <NodePlate icon={CircleAlert}>{t('panel.tooOld')}</NodePlate>;
    }
    if (state.status === 'loading') {
        return <NodePlate busy>{t('view.loading')}</NodePlate>;
    }
    if (state.status === 'unreachable') {
        return <NodePlate icon={WifiOff}>{t('view.unreachable')}</NodePlate>;
    }
    if (state.status === 'gone') {
        return <Removed />;
    }
    return <ArtifactVersionOnCanvas {...props} endpointId={endpointId} result={state.result} />;
}

function Removed() {
    const { t } = useTranslation('output');
    return (
        <NodePlate icon={Package}>
            <span className="text-text">{t('node.removed')}</span>
            <span>{t('node.removedDetail')}</span>
        </NodePlate>
    );
}

function ArtifactVersionOnCanvas({
    endpointId,
    result,
    version: picked,
    onPin,
    titled = false,
    note = null
}: ArtifactOnCanvasProps & { endpointId: string; result: ArtifactGetResult }) {
    const { t } = useTranslation('output');
    const { artifact, versions } = result;
    const latest = versions[0]!;
    const version = picked === undefined ? latest : versions.find((entry) => entry.versionId === picked);
    const controls = (
        <>
            {titled && <span className="min-w-0 grow truncate text-sm font-medium text-text">{artifact.title}</span>}
            {onPin !== null ? (
                <Menu.Root>
                    <Menu.Trigger render={<Button size="xs" variant="secondary" />}>
                        {picked === undefined ? t('view.latest') : t('node.pinned', { number: version?.number ?? '?' })}
                        <Icon icon={ChevronDown} size={12} />
                    </Menu.Trigger>
                    <Menu.Popup align="end" className="max-h-80 min-w-56 overflow-y-auto">
                        <Menu.RadioGroup value={picked ?? FOLLOW_LATEST} onValueChange={(next: string) => onPin(next === FOLLOW_LATEST ? null : next)}>
                            <Menu.RadioItem value={FOLLOW_LATEST} closeOnClick>
                                {t('node.follow')}
                            </Menu.RadioItem>
                            <Menu.Separator />
                            {versions.map((entry) => (
                                <Menu.RadioItem key={entry.versionId} value={entry.versionId} className="tabular-nums" closeOnClick>
                                    {t('node.version', { number: entry.number, date: formatDayClock(entry.createdAt) })}
                                </Menu.RadioItem>
                            ))}
                        </Menu.RadioGroup>
                    </Menu.Popup>
                </Menu.Root>
            ) : (
                version !== undefined && <Pill className="tabular-nums">{t('node.pinned', { number: version.number })}</Pill>
            )}
            <IconButton icon={Maximize2} size="sm" label={t('node.open')} onClick={() => openArtifact(artifact.artifactId, artifact.title, picked ?? null)} />
        </>
    );
    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <NodeHeaderControls>{controls}</NodeHeaderControls>
            {note !== null && <p className="shrink-0 border-b border-border bg-surface-sunken px-3 py-1.5 text-xs text-text-muted">{note}</p>}
            {version === undefined ? (
                <Removed />
            ) : (
                <>
                    <ErrorBoundary label={t('view.failed')} resetKeys={[version.versionId]} className="flex min-h-0 grow flex-col">
                        <VersionBody endpointId={endpointId} artifact={artifact} version={version} />
                    </ErrorBoundary>
                    <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-text-muted">
                        {version.versionId === latest.versionId ? (
                            <span className="truncate tabular-nums">
                                {t('node.version', { number: version.number, date: formatDayClock(version.createdAt) })}
                            </span>
                        ) : (
                            <>
                                <span className="grow truncate">{t('node.newer', { number: latest.number })}</span>
                                {onPin !== null && (
                                    <Button size="xs" variant="ghost" onClick={() => onPin(latest.versionId)}>
                                        {t('node.showIt')}
                                    </Button>
                                )}
                            </>
                        )}
                    </footer>
                </>
            )}
        </div>
    );
}
