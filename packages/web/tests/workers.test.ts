import { describe, expect, it } from 'vitest';
import { toProtoJsonEnvelope } from '../src/proto_json.js';
import { validateWorkerMessage } from '../src/workers.js';

const BASE = 'type.googleapis.com/savvifi.hrcrawl.ui.v1';

describe('validateWorkerMessage', () => {
  it('rejects non-object messages', () => {
    expect(validateWorkerMessage(null)).toMatch(/Worker message must be an object/);
    expect(validateWorkerMessage('hi')).toMatch(/Worker message must be an object/);
  });

  it('rejects messages without a string type', () => {
    expect(validateWorkerMessage({})).toMatch(/Worker message must be an object/);
  });

  it('rejects unknown command types', () => {
    expect(validateWorkerMessage({ type: 'whatever' })).toMatch(/Unsupported worker message type/);
  });

  it('accepts an init command with an object payload', () => {
    expect(validateWorkerMessage({ type: 'init', payload: { tenant: 't1' } })).toBe('');
  });

  it('rejects init when payload is not an object', () => {
    expect(validateWorkerMessage({ type: 'init', payload: 'oops' })).toMatch(
      /init\.payload.*must be an object/,
    );
  });

  it('rejects attributeChanged with a missing or empty name', () => {
    expect(validateWorkerMessage({ type: 'attributeChanged', name: '' })).toMatch(
      /attributeChanged\.name.*must be a non-empty string/,
    );
  });

  it('accepts a dispose command', () => {
    expect(validateWorkerMessage({ type: 'dispose' })).toBe('');
  });

  it('decodes a proto-JSON envelope into the legacy fields', () => {
    const message: any = {
      envelope: toProtoJsonEnvelope(`${BASE}.WorkerEvent`, {
        name: 'search/submit',
        payload: { query: 'foo' },
      }),
    };
    expect(validateWorkerMessage(message)).toBe('');
    expect(message.type).toBe('event');
    expect(message.name).toBe('search/submit');
    expect(message.payload).toEqual({ query: 'foo' });
  });
});
