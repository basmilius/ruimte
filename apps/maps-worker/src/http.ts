import { MAPS_ERROR_STATUS, corsHeaders as corsHeadersFor, failureOf } from '@ruimte/pulsar';

export { allowedOrigin, json } from '@ruimte/pulsar';

export const failure = failureOf(MAPS_ERROR_STATUS);

export const corsHeaders = corsHeadersFor('GET, POST, OPTIONS');
