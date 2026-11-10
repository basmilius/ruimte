import { Button, ChoiceCards, FormError, ScrollArea, Spinner, type Choice, messageOf, useWindowControlsInset } from '@adecore/ui';
import { MonitorSmartphone, Server } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STRIP_PADDING_PX, desktop } from '@/desktop/bridge';
import { isShellFailure } from '@/desktop/shell-failure';
import { WELCOME_SKY } from '@/onboarding/welcome-sky';
import { useSettings } from '@/state/settings';
import { BrandSymbol } from '@/ui/Brand';
import { Eclipse } from '@/ui/Eclipse';

type FirstChoice = 'local' | 'none';

/*
 * What a new install shows before anything runs: whether this computer runs agents or only opens the
 * machines of an account. The shell restarts the app with the answer; a machine that already runs here
 * is the shell's to use, so the choice reads the same either way.
 */
export function FirstRunScreen() {
    const { t } = useTranslation('onboarding');
    const inset = useWindowControlsInset();
    const machine = desktop()?.machine;
    const [value, setValue] = useState<FirstChoice>('local');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const choices: Choice<FirstChoice>[] = [
        { value: 'local', title: t('firstRun.local.title'), description: t('firstRun.local.description'), icon: Server },
        { value: 'none', title: t('firstRun.none.title'), description: t('firstRun.none.description'), icon: MonitorSmartphone }
    ];

    const proceed = (): void => {
        if (machine === undefined) {
            return;
        }
        setBusy(true);
        setFailure(null);
        // Read after the restart, which opens the task list instead of the welcome the person just had here.
        useSettings.getState().update({ onboardingSkipWelcome: value === 'local' });
        machine.choose(value).catch((e: unknown) => {
            useSettings.getState().update({ onboardingSkipWelcome: false });
            setFailure(isShellFailure(e) ? t('firstRun.failedGeneric') : t('firstRun.failed', { reason: messageOf(e) }));
            setBusy(false);
        });
    };

    return (
        <div className="relative flex h-full w-full flex-col bg-bg">
            <div className="app-drag absolute inset-x-0 top-0 z-10 h-12" style={{ paddingLeft: inset ?? STRIP_PADDING_PX }} />
            <ScrollArea className="grow" viewportClassName="relative flex flex-col items-center pt-12">
                <Eclipse center={216} {...WELCOME_SKY} className="h-full" />
                <div className="relative mt-30 flex w-full max-w-md flex-col items-center gap-4 px-8 pb-12 text-center">
                    <BrandSymbol size={96} className="rounded-[22px] shadow-float" />
                    <h1 className="text-4xl font-semibold tracking-tight text-text">{t('welcome.title')}</h1>
                    <p className="max-w-[420px] text-base text-text-muted">{t('firstRun.body')}</p>
                    <ChoiceCards
                        value={value}
                        onValueChange={setValue}
                        choices={choices}
                        label={t('firstRun.choices')}
                        orientation="vertical"
                        radio="end"
                        disabled={busy}
                        className="mt-2 w-full text-left"
                    />
                    <p className="text-xs text-text-muted">{t('firstRun.note')}</p>
                    <Button variant="primary" disabled={busy} onClick={proceed}>
                        {busy ? (
                            <>
                                <Spinner size={14} />
                                {t('firstRun.restarting')}
                            </>
                        ) : (
                            t('firstRun.continue')
                        )}
                    </Button>
                    {failure !== null && <FormError>{failure}</FormError>}
                </div>
            </ScrollArea>
        </div>
    );
}
