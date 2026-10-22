import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Scaling } from 'lucide-react';
import { NODE_SIZE, NODE_SIZE_MAX, NODE_SIZE_MIN, NodeKindSchema, type NodeKind, type NodeSize, type NodeSizes } from '@ruimte/contracts';
import { Button, DisabledReason, Field, Input } from '@adecore/ui';
import { formatNumber, useFormatLocale } from '@adecore/ui/format';
import { SettingsRow, TopIcon } from '@adecore/ui/settings';
import { formatNodeSize, setDefaultSize } from '@/canvas/default-size';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { readNodeSide, storedNodeSize, type NodeSide } from '@/shell/settings/node-size-fields';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useServers } from '@/state/server';
import { useEndpointConnection } from '@/transport/status';

/* The search lands on the first row of the first machine that keeps sizes. */
const SEARCH_ID = 'views.nodeSizes';

const SIDES: readonly NodeSide[] = ['w', 'h'];

interface NodeSizeRowProps {
    endpoint: Endpoint;
    kind: NodeKind;
    custom: NodeSize | undefined;
    connected: boolean;
    searchId?: string;
}

function NodeSizeRow({ endpoint, kind, custom, connected, searchId }: NodeSizeRowProps) {
    const { t } = useTranslation('settings');
    const [drafts, setDrafts] = useState<Partial<Record<NodeSide, string>>>({});
    const [resetting, setResetting] = useState(false);
    // Enter saves and the blur after it would save the same draft again before the machine answered.
    const saving = useRef(false);
    const name = t(`shell:nodeKinds.${kind}`);
    const builtIn = NODE_SIZE[kind];
    const current = custom ?? builtIn;

    const problemOf = (side: NodeSide) => {
        const draft = drafts[side];
        if (draft === undefined) {
            return null;
        }
        const reading = readNodeSide(draft, side);
        return reading.ok ? null : reading.problem;
    };
    const wrongSide = SIDES.find((side) => problemOf(side) !== null);
    const error =
        wrongSide === undefined
            ? null
            : t(`views.nodeSizes.${problemOf(wrongSide)!}`, {
                  side: t(wrongSide === 'w' ? 'views.nodeSizes.width' : 'views.nodeSizes.height'),
                  min: formatNumber(NODE_SIZE_MIN[wrongSide]),
                  max: formatNumber(NODE_SIZE_MAX)
              });

    const forget = (side: NodeSide): void => {
        setDrafts(({ [side]: _gone, ...rest }) => rest);
    };

    const save = async (side: NodeSide): Promise<void> => {
        const draft = drafts[side];
        if (draft === undefined || saving.current) {
            return;
        }
        const reading = readNodeSide(draft, side);
        if (!reading.ok) {
            return;
        }
        const size = { ...current, [side]: reading.value };
        if (size.w === current.w && size.h === current.h) {
            forget(side);
            return;
        }
        saving.current = true;
        try {
            await setDefaultSize(endpoint.id, kind, storedNodeSize(kind, size));
        } finally {
            saving.current = false;
            forget(side);
        }
    };

    const leave = (side: NodeSide): void => {
        if (problemOf(side) !== null) {
            forget(side);
            return;
        }
        void save(side);
    };

    const onKeyDown = (side: NodeSide, event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void save(side);
        }
        // Escape takes back a change first; the dialog only closes from a field that holds none.
        if (event.key === 'Escape' && drafts[side] !== undefined) {
            event.stopPropagation();
            forget(side);
        }
    };

    const reset = async (): Promise<void> => {
        setResetting(true);
        setDrafts({});
        try {
            await setDefaultSize(endpoint.id, kind, null);
        } finally {
            setResetting(false);
        }
    };

    const field = (side: NodeSide) => (
        <Input
            className="w-18 text-right tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            aria-label={t(side === 'w' ? 'views.nodeSizes.widthLabel' : 'views.nodeSizes.heightLabel', { kind: name, machine: endpoint.label })}
            aria-invalid={problemOf(side) !== null || undefined}
            disabled={!connected}
            value={drafts[side] ?? String(current[side])}
            onChange={(event) => setDrafts((before) => ({ ...before, [side]: event.target.value }))}
            onBlur={() => leave(side)}
            onKeyDown={(event) => onKeyDown(side, event)}
        />
    );

    return (
        <SettingsRow
            searchId={searchId}
            leading={<TopIcon icon={NODE_KIND_ICONS[kind]} size={20} className="text-text-muted" />}
            label={name}
            description={custom === undefined ? t('views.nodeSizes.builtIn') : t('views.nodeSizes.custom', { builtIn: formatNodeSize(builtIn) })}
            control={
                <DisabledReason reason={connected ? null : t('machine.notAnswering')}>
                    <div className="flex items-start gap-2">
                        {custom !== undefined && (
                            <Button
                                disabled={resetting || !connected}
                                aria-label={t('views.nodeSizes.resetLabel', { kind: name, machine: endpoint.label })}
                                onClick={() => void reset()}
                            >
                                {t('views.nodeSizes.reset')}
                            </Button>
                        )}
                        <Field group error={error}>
                            <div className="flex items-center gap-1.5">
                                {field('w')}
                                <span aria-hidden className="text-sm text-text-muted">
                                    ×
                                </span>
                                {field('h')}
                            </div>
                        </Field>
                    </div>
                </DisabledReason>
            }
        />
    );
}

function NodeSizeSection({ endpoint, sizes, searchId }: { endpoint: Endpoint; sizes: NodeSizes; searchId?: string }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';

    return (
        <SettingsSection
            title={t('views.nodeSizes.title', { machine: endpoint.label })}
            description={t('views.nodeSizes.description')}
            icon={Scaling}
            scope="machine"
        >
            {NodeKindSchema.options.map((kind, index) => (
                <NodeSizeRow
                    key={kind}
                    endpoint={endpoint}
                    kind={kind}
                    custom={sizes[kind]}
                    connected={connected}
                    searchId={index === 0 ? searchId : undefined}
                />
            ))}
        </SettingsSection>
    );
}

/* A section per machine this client heard from, a row per kind a person can add to a canvas. */
export function NodeSizeSections() {
    useFormatLocale();
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = listedEndpoints(stored);
    // Nothing here holds a link, so a section reads what a connected machine last said.
    const servers = useServers((s) => s.byEndpoint);
    const keeping = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ].filter((endpoint) => servers[endpoint.id] !== undefined);

    return (
        <>
            {keeping.map((endpoint, index) => (
                <NodeSizeSection key={endpoint.id} endpoint={endpoint} sizes={servers[endpoint.id]!.nodeSizes} searchId={index === 0 ? SEARCH_ID : undefined} />
            ))}
        </>
    );
}
