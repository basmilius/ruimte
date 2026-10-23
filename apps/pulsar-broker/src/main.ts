import { NO_METER } from './broker.ts';
import { parseBrokerArgs } from './config.ts';
import { startBroker } from './server.ts';
import { sentryMeter, startTelemetry, stopTelemetry } from './telemetry.ts';

let config;
try {
    config = parseBrokerArgs(process.argv.slice(2));
} catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
}

if (config.telemetry) {
    startTelemetry();
}
const running = startBroker(config, config.telemetry ? sentryMeter : NO_METER);
const names = config.names.length > 0 ? config.names.join(', ') : 'any Host header';
const behind = [config.trustProxy ? 'a proxy' : null, config.trustCloudflare ? 'Cloudflare' : null].filter((entry) => entry !== null).join(' and ');
const turn = config.turn.kind === 'none' ? 'no TURN' : config.turn.kind === 'shared-secret' ? `TURN at ${config.turn.urls.join(', ')}` : 'TURN from Cloudflare';
console.log(`pulsar broker listening on ws://${config.host}:${running.port} (answers to ${names}${behind === '' ? '' : `, behind ${behind}`}, ${turn})`);

function shutdown(signal: string): void {
    console.log(`pulsar broker received ${signal}, closing sockets`);
    void running
        .stop()
        .then(stopTelemetry)
        .then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
