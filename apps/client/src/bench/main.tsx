import { createRoot } from 'react-dom/client';
import { BenchPage } from '@/bench/BenchPage';
import { connectPlatform } from '@/desktop/bridge';
import { connectFormat } from '@/format/source';
import { initI18n } from '@/i18n';
import { startTelemetry } from '@/telemetry/report';
import '@/state/theme';
import '@/state/settings';
import '@/styles.css';

startTelemetry();
connectFormat();
connectPlatform();
await initI18n();

createRoot(document.getElementById('root')!).render(<BenchPage />);
