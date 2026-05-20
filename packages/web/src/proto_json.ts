export type ProtoJsonEnvelope<T = Record<string, unknown>> = {
  '@type': string;
  payload?: T;
  metadata?: Record<string, unknown>;
};

export function toProtoJsonEnvelope<T = Record<string, unknown>>(
  typeUrl: string,
  payload?: T,
  metadata?: Record<string, unknown>,
): ProtoJsonEnvelope<T> {
  const envelope: ProtoJsonEnvelope<T> = {
    '@type': typeUrl,
  };

  if (payload !== undefined) {
    envelope.payload = payload;
  }
  if (metadata && Object.keys(metadata).length) {
    envelope.metadata = metadata;
  }

  return envelope;
}

export function parseProtoJsonEnvelope<T = Record<string, unknown>>(
  message: unknown,
): ProtoJsonEnvelope<T> | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }

  const candidate = message as Record<string, unknown>;
  if (typeof candidate['@type'] !== 'string' || !candidate['@type']) {
    return null;
  }

  const envelope: ProtoJsonEnvelope<T> = {
    '@type': candidate['@type'],
  };

  if ('payload' in candidate) {
    envelope.payload = candidate.payload as T;
  }
  if (
    'metadata' in candidate &&
    candidate.metadata &&
    typeof candidate.metadata === 'object' &&
    !Array.isArray(candidate.metadata)
  ) {
    envelope.metadata = candidate.metadata as Record<string, unknown>;
  }

  return envelope;
}
