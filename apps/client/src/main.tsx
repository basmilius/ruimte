import { ChatHostProvider } from '@adecore/agents-react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { CHAT_HOST } from '@/chat/host';
import { applyStoredExtensionTheme } from '@/extensions/themes';
import { initI18n } from '@/i18n';
import { reportCaught } from '@/telemetry/report';
import { wireClient } from '@/wiring/client';
import '@/state/theme';
import '@/state/settings';
import '@fontsource-variable/fira-code';
import '@fontsource-variable/geist';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles.css';

wireClient();

/* The words come first: a screen drawn before its language is in would swap under a person. */
await initI18n();

applyStoredExtensionTheme();

createRoot(document.getElementById('root')!, { onCaughtError: reportCaught }).render(
    <ChatHostProvider host={CHAT_HOST}>
        <App />
    </ChatHostProvider>
);
