import { useTranslation } from 'react-i18next';
import { Segmented, Select, Stepper } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { TerminalShellRow } from '@/shell/settings/MachineSettings';
import { IntegrationsSection } from '@/shell/settings/panes/IntegrationsSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useServers } from '@/state/server';
import { useEndpointConnection } from '@/transport/status';
import { FONT_SIZE_RANGE, MONO_FONTS, monoFontStack, TERMINAL_LINE_HEIGHT_RANGE, terminalFontOf, useSettings } from '@/state/settings';

function TerminalPreview({ fontSize, fontFamily }: { fontSize: number; fontFamily: string }) {
    return (
        <div
            className="overflow-x-auto rounded-lg bg-term-bg px-3.5 py-3 leading-normal whitespace-pre text-term-fg"
            style={{ fontSize: `${fontSize}px`, fontFamily }}
            aria-hidden
        >
            <span className="text-term-green">~/Development/ruimte</span> <span className="text-term-blue">main</span> ❯ bun run dev
            {'\n'}
            <span className="text-term-dim">ready in 412 ms</span>
        </div>
    );
}

export function TerminalPane() {
    const { t } = useTranslation('settings');
    const fontSize = useSettings((s) => s.fontSize);
    const terminalFont = useSettings((s) => s.terminalFont);
    const editorFont = useSettings((s) => s.font);
    const previewFont = terminalFontOf({ font: editorFont, terminalFont });
    const terminalLineHeight = useSettings((s) => s.terminalLineHeight);
    const terminalLinkDestination = useSettings((s) => s.terminalLinkDestination);
    const update = useSettings((s) => s.update);
    const local = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID) ?? null);
    const connection = useEndpointConnection(LOCAL_ENDPOINT_ID);
    const platform = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.platform);

    return (
        <>
            {local !== null && hasLocalMachine() && platform === 'win32' && (
                <SettingsSection title={t('machine.terminalShell.label')} scope="computer">
                    <TerminalShellRow endpoint={local} reason={connection.status === 'open' ? null : t('machineDialog.availableWhenAnswering')} />
                </SettingsSection>
            )}
            <SettingsSection title={t('terminal.font.title')}>
                <SettingsRow
                    searchId="terminal.font.family"
                    label={t('terminal.font.family.label')}
                    description={t('terminal.font.family.description')}
                    control={
                        <Select
                            value={terminalFont}
                            label={t('terminal.font.family.label')}
                            align="end"
                            items={[
                                { value: 'editor', label: t('terminal.font.family.editor') },
                                ...MONO_FONTS.map((entry) => ({
                                    value: entry.id,
                                    label: entry.id === 'system' ? t('terminal.font.family.system') : entry.label
                                }))
                            ]}
                            onValueChange={(value) => update({ terminalFont: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="terminal.font.size"
                    label={t('terminal.font.size.label')}
                    description={t('terminal.font.size.description')}
                    control={
                        <Stepper
                            value={fontSize}
                            min={FONT_SIZE_RANGE.min}
                            max={FONT_SIZE_RANGE.max}
                            step={FONT_SIZE_RANGE.step}
                            unit=" px"
                            label={t('terminal.font.size.label')}
                            onValueChange={(value) => update({ fontSize: value })}
                        />
                    }
                >
                    <TerminalPreview fontSize={fontSize} fontFamily={monoFontStack(previewFont)} />
                </SettingsRow>
                <SettingsRow
                    searchId="terminal.font.lineHeight"
                    label={t('terminal.font.lineHeight.label')}
                    description={t('terminal.font.lineHeight.description')}
                    control={
                        <Stepper
                            value={terminalLineHeight}
                            min={TERMINAL_LINE_HEIGHT_RANGE.min}
                            max={TERMINAL_LINE_HEIGHT_RANGE.max}
                            step={TERMINAL_LINE_HEIGHT_RANGE.step}
                            unit="×"
                            label={t('terminal.font.lineHeight.label')}
                            onValueChange={(value) => update({ terminalLineHeight: value })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('terminal.links.title')}>
                <SettingsRow
                    searchId="terminal.links"
                    label={t('terminal.links.label')}
                    description={t('terminal.links.description')}
                    control={
                        <Segmented
                            value={terminalLinkDestination}
                            options={[
                                { id: 'external', label: t('terminal.links.options.external') },
                                { id: 'ruimte', label: t('terminal.links.options.ruimte') }
                            ]}
                            label={t('terminal.links.label')}
                            onValueChange={(value) => update({ terminalLinkDestination: value })}
                        />
                    }
                />
            </SettingsSection>
            <IntegrationsSection />
        </>
    );
}
