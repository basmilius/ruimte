import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { PROVIDER_NAMES, type ProviderId } from '@ruimte/pulsar';
import { signInToPulsar, usePulsarAccount } from '@/pulsar/account';
import { Button } from '@ruimte/ui/Button';
import { SignInMark } from '@/ui/SignInMark';

interface ProviderButtonProps {
    provider: ProviderId;
    /* "Sign in" where it opens a session, "Continue" where it adds a provider to one: the titles Apple allows. */
    verb: 'Sign in' | 'Continue';
    disabled?: boolean;
    onClick(): void;
}

/*
 * One provider's button. Both are the same inverse button with the mark before the title, so neither
 * choice is less prominent than the other, which is what Apple's guidelines ask of the Apple button.
 */
export function ProviderButton({ provider, verb, disabled, onClick }: ProviderButtonProps) {
    const { t } = useTranslation('shell');
    const name = PROVIDER_NAMES[provider];
    return (
        <Button variant="inverse" disabled={disabled} onClick={onClick}>
            <SignInMark provider={provider} /> {verb === 'Continue' ? t('signIn.continueWith', { provider: name }) : t('signIn.signInWith', { provider: name })}
        </Button>
    );
}

/*
 * Every provider the address book offers, wherever signing in is offered. `confirm` opens the account
 * section with how it went; a flow with a next step of its own leaves it off, so nothing covers that step.
 */
export function SignInButtons({ className, confirm = false }: { className?: string; confirm?: boolean }) {
    const providers = usePulsarAccount((s) => s.providers);
    return (
        <div className={clsx('flex flex-wrap items-center gap-2', className)}>
            {providers.map((provider) => (
                <ProviderButton key={provider} provider={provider} verb="Sign in" onClick={() => void signInToPulsar(provider, { confirm })} />
            ))}
        </div>
    );
}
