import { describe, expect, it } from 'vitest';
import { parseProtoJsonEnvelope, toProtoJsonEnvelope } from '../src/proto_json.js';

const TYPE = 'type.googleapis.com/example.v1.Foo';

describe('toProtoJsonEnvelope', () => {
  it('emits only @type when no payload or metadata', () => {
    expect(toProtoJsonEnvelope(TYPE)).toEqual({ '@type': TYPE });
  });

  it('includes payload when defined (even if empty)', () => {
    expect(toProtoJsonEnvelope(TYPE, {})).toEqual({ '@type': TYPE, payload: {} });
  });

  it('omits metadata when empty', () => {
    expect(toProtoJsonEnvelope(TYPE, { x: 1 }, {})).toEqual({
      '@type': TYPE,
      payload: { x: 1 },
    });
  });

  it('includes metadata when non-empty', () => {
    expect(toProtoJsonEnvelope(TYPE, { x: 1 }, { traceId: 'abc' })).toEqual({
      '@type': TYPE,
      payload: { x: 1 },
      metadata: { traceId: 'abc' },
    });
  });
});

describe('parseProtoJsonEnvelope', () => {
  it('returns null for falsy or non-object input', () => {
    expect(parseProtoJsonEnvelope(null)).toBeNull();
    expect(parseProtoJsonEnvelope(undefined)).toBeNull();
    expect(parseProtoJsonEnvelope('string')).toBeNull();
    expect(parseProtoJsonEnvelope([1, 2])).toBeNull();
  });

  it('returns null when @type is missing or empty', () => {
    expect(parseProtoJsonEnvelope({})).toBeNull();
    expect(parseProtoJsonEnvelope({ '@type': '' })).toBeNull();
    expect(parseProtoJsonEnvelope({ '@type': 42 })).toBeNull();
  });

  it('round-trips through toProtoJsonEnvelope', () => {
    const envelope = toProtoJsonEnvelope(TYPE, { foo: 'bar' }, { traceId: 't1' });
    expect(parseProtoJsonEnvelope(envelope)).toEqual(envelope);
  });

  it('drops malformed metadata while preserving payload', () => {
    const parsed = parseProtoJsonEnvelope({
      '@type': TYPE,
      payload: { ok: true },
      metadata: 'not-an-object',
    });
    expect(parsed).toEqual({ '@type': TYPE, payload: { ok: true } });
  });
});
