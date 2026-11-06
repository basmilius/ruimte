import { ButtonGroup, Icon, Kbd, KEY_SHORTCUTS } from '@adecore/ui';
import { CaseSensitive, FileSearch, Regex, WholeWord } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaletteContext, PaletteModeView } from '@/palette/palette-entries';
import { DEFAULT_GREP_OPTIONS, groupByFile, useGrepSearch, type GrepOptions } from '@/palette/palette-grep';
import { GrepFileLabel, GrepItem, type GrepRow } from '@/palette/PaletteGrepResults';
import { PaletteSearchToggle } from '@/palette/PaletteSearchToggle';
import { useUi } from '@/state/ui';

/* Find in files: the lines of the project folder that match the field, with the three ways a match is read. */
export function usePaletteGrep(
    context: PaletteContext,
    { enabled, folder, openFile }: { enabled: boolean; folder: string | null; openFile(path: string, line: number | null): void }
): PaletteModeView<GrepRow> {
    const { t } = useTranslation(['shell']);
    const { query, close } = context;
    const [grepOptions, setGrepOptions] = useState<GrepOptions>(DEFAULT_GREP_OPTIONS);
    const grep = useGrepSearch(enabled ? folder : null, enabled ? query : '', grepOptions);

    const runHit = ({ match }: GrepRow): void => {
        close();
        openFile(match.path, match.line);
    };

    return {
        groups: groupByFile(grep.matches).map((group) => ({
            value: group.path,
            label: <GrepFileLabel path={group.path} count={group.matches.length} />,
            items: group.matches.map((match) => ({ id: `${match.path}:${match.line}:${match.column}`, match }))
        })),
        item: (row) => <GrepItem key={row.id} row={row} onRun={runHit} />,
        // The mode leaves the way it was entered: one key, nothing typed.
        back: () => useUi.getState().setPaletteMode('default'),
        leading: <Icon icon={FileSearch} size={14} className="shrink-0 text-accent" />,
        trailing: (
            <ButtonGroup render={<span />}>
                <PaletteSearchToggle
                    icon={CaseSensitive}
                    label={t('palette.matchCase')}
                    active={grepOptions.caseSensitive}
                    onClick={() => setGrepOptions((current) => ({ ...current, caseSensitive: !current.caseSensitive }))}
                />
                <PaletteSearchToggle
                    icon={WholeWord}
                    label={t('palette.wholeWords')}
                    active={grepOptions.wholeWord}
                    onClick={() => setGrepOptions((current) => ({ ...current, wholeWord: !current.wholeWord }))}
                />
                <PaletteSearchToggle
                    icon={Regex}
                    label={t('palette.regex')}
                    active={grepOptions.regex}
                    onClick={() => setGrepOptions((current) => ({ ...current, regex: !current.regex }))}
                />
            </ButtonGroup>
        ),
        status:
            query.trim() === ''
                ? t('palette.typeToSearch')
                : !grep.busy && grep.failure === null && grep.matches.length === 0
                  ? t('palette.noLineMatch')
                  : null,
        footer: (
            <>
                {grep.failure !== null ? (
                    <span className="text-status-error" role="alert">
                        {grep.failure}
                    </span>
                ) : (
                    <span>
                        {grep.matches.length === 0
                            ? t('palette.nothingYet')
                            : t('palette.grepCount', { count: grep.files, hits: `${grep.matches.length}${grep.truncated ? '+' : ''}` })}
                    </span>
                )}
                <span className="grow" />
                <span>
                    <Kbd shortcut={KEY_SHORTCUTS.enter} variant="inline" /> {t('palette.grepEnterHint')}{' '}
                    <Kbd shortcut={KEY_SHORTCUTS.backspace} variant="inline" /> {t('palette.grepBackHint')}
                </span>
            </>
        )
    };
}
