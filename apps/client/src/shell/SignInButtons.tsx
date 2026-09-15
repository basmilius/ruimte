import clsx from 'clsx';
import { PROVIDER_NAMES, type ProviderId } from '@ruimte/pulsar';
import { signInToPulsar, usePulsarAccount } from '@/pulsar/account';
import { Button } from '@/ui/Button';
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
    return (
        <Button variant="inverse" disabled={disabled} onClick={onClick}>
            <SignInMark provider={provider} /> {verb} with {PROVIDER_NAMES[provider]}
        </Button>
    );
}

/* Every provider the address book offers, wherever signing in is offered. */
export function SignInButtons({ className }: { className?: string }) {
    const providers = usePulsarAccount((s) => s.providers);
    return (
        <div className={clsx('flex flex-wrap items-center gap-2', className)}>
            {providers.map((provider) => (
                <ProviderButton key={provider} provider={provider} verb="Sign in" onClick={() => void signInToPulsar(provider)} />
            ))}
        </div>
    );
}
