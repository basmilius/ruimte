import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { parseAnsi } from '../logic/ansi';

export function AnsiOutput({ text, limit, tailLines }: { text: string; limit?: number; tailLines?: number }) {
    const { t } = useTranslation('agent-chat');
    const { tokens, omitted } = useMemo(() => parseAnsi(text, { limit, tailLines }), [text, limit, tailLines]);
    return (
        <>
            {tokens.map((token, index) => (
                <span key={index} style={token.style}>
                    {token.content}
                </span>
            ))}
            {omitted > 0 && `\n${t('work.moreCharacters', { count: omitted })}`}
        </>
    );
}
