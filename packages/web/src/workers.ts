import { parseProtoJsonEnvelope, toProtoJsonEnvelope } from './proto_json.js';

const WORKER_MSG_BASE = 'type.googleapis.com/savvifi.hrcrawl.ui.v1';
const WORKER_INIT_TYPE = `${WORKER_MSG_BASE}.WorkerInit`;
const WORKER_ATTRIBUTE_CHANGED_TYPE = `${WORKER_MSG_BASE}.WorkerAttributeChanged`;
const WORKER_EVENT_TYPE = `${WORKER_MSG_BASE}.WorkerEvent`;
const WORKER_DISPOSE_TYPE = `${WORKER_MSG_BASE}.WorkerDispose`;

export class MeridianWorkerController {
  private _url: string;
  private _mode: string;
  private _onRenderModel?: (model: any) => void;
  private _onEmit?: (msg: any) => void;
  private _onStatus?: (msg: any) => void;
  private _worker: Worker | null = null;
  private _messagePort: Worker | null = null;

  constructor(
    url: string,
    {
      mode = 'dedicated',
      onRenderModel,
      onEmit,
      onStatus,
    }: {
      mode?: string;
      onRenderModel?: (model: any) => void;
      onEmit?: (msg: any) => void;
      onStatus?: (msg: any) => void;
    } = {},
  ) {
    this._url = url;
    this._mode = mode;
    this._onRenderModel = onRenderModel;
    this._onEmit = onEmit;
    this._onStatus = onStatus;
    this._handleMessage = this._handleMessage.bind(this);
    this._handleError = this._handleError.bind(this);
  }

  start(payload: any = {}) {
    if (this._messagePort) return;
    if (this._mode !== 'dedicated') {
      this._onStatus?.({
        level: 'error',
        message: `Unsupported Meridian worker mode: ${this._mode}`,
      });
      return;
    }
    if (typeof Worker === 'undefined') {
      this._onStatus?.({
        level: 'error',
        message: 'Web Workers are unavailable in this browser.',
      });
      return;
    }
    try {
      this._worker = new Worker(this._url, { type: 'module' });
    } catch (error: any) {
      const reason = error?.message || String(error);
      this._onStatus?.({
        level: 'error',
        message: `Failed to start worker ${this._url}: ${reason}`,
      });
      return;
    }
    this._messagePort = this._worker;
    this._worker.addEventListener('message', this._handleMessage);
    this._worker.addEventListener('error', this._handleError);
    this._worker.addEventListener('messageerror', this._handleError);
    this._worker.postMessage({
      type: 'init',
      payload,
      envelope: toProtoJsonEnvelope(WORKER_INIT_TYPE, { payload }),
    });
  }

  updateAttribute(name: string, value: any) {
    this._messagePort?.postMessage({
      type: 'attributeChanged',
      name,
      value,
      envelope: toProtoJsonEnvelope(WORKER_ATTRIBUTE_CHANGED_TYPE, { name, value }),
    });
  }

  dispatch(name: string, payload: any) {
    this._messagePort?.postMessage({
      type: 'event',
      name,
      payload,
      envelope: toProtoJsonEnvelope(WORKER_EVENT_TYPE, { name, payload }),
    });
  }

  dispose() {
    if (!this._messagePort) return;
    this._messagePort.postMessage({
      type: 'dispose',
      envelope: toProtoJsonEnvelope(WORKER_DISPOSE_TYPE, {}),
    });
    if (this._worker) {
      this._worker.removeEventListener('message', this._handleMessage);
      this._worker.removeEventListener('error', this._handleError);
      this._worker.removeEventListener('messageerror', this._handleError);
      this._worker.terminate();
    }
    this._worker = null;
    this._messagePort = null;
  }

  private _handleMessage(event: MessageEvent) {
    const message = event.data || {};
    switch (message.type) {
      case 'renderModel':
        this._onRenderModel?.(message.model);
        break;
      case 'emit':
        this._onEmit?.(message);
        break;
      case 'status':
        this._onStatus?.(message);
        break;
      default:
        break;
    }
  }

  private _handleError(event: ErrorEvent | MessageEvent) {
    const maybeErr = event as ErrorEvent;
    const details: string[] = [];
    if (maybeErr.filename) {
      details.push(`file=${maybeErr.filename}`);
    }
    if (maybeErr.lineno || maybeErr.colno) {
      details.push(`line=${maybeErr.lineno || 0}`, `col=${maybeErr.colno || 0}`);
    }

    const message = maybeErr.message || `Worker error while loading ${this._url}`;
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    this._onStatus?.({
      level: 'error',
      message: `${message}${suffix}`,
    });
  }
}

function isPlainObject(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const MERIDIAN_WORKER_COMMANDS = new Set(['init', 'attributeChanged', 'event', 'dispose']);

export function validateWorkerMessage(message: any): string {
  const envelope = parseProtoJsonEnvelope(message?.envelope);

  if (envelope && typeof envelope['@type'] === 'string') {
    const payload = (envelope.payload || {}) as Record<string, any>;
    if (envelope['@type'] === WORKER_INIT_TYPE) {
      message.type = 'init';
      message.payload = payload.payload ?? {};
    } else if (envelope['@type'] === WORKER_ATTRIBUTE_CHANGED_TYPE) {
      message.type = 'attributeChanged';
      message.name = payload.name;
      message.value = payload.value;
    } else if (envelope['@type'] === WORKER_EVENT_TYPE) {
      message.type = 'event';
      message.name = payload.name;
      message.payload = payload.payload;
    } else if (envelope['@type'] === WORKER_DISPOSE_TYPE) {
      message.type = 'dispose';
    }
  }

  if (!isPlainObject(message) || typeof message.type !== 'string') {
    return 'Worker message must be an object with a string `type`.';
  }
  if (!MERIDIAN_WORKER_COMMANDS.has(message.type)) {
    return `Unsupported worker message type: ${message.type}`;
  }
  switch (message.type) {
    case 'init':
      if ('payload' in message && !isPlainObject(message.payload)) {
        return '`init.payload` must be an object when provided.';
      }
      return '';
    case 'attributeChanged':
      if (typeof message.name !== 'string' || !message.name.trim()) {
        return '`attributeChanged.name` must be a non-empty string.';
      }
      return '';
    case 'event':
      if (typeof message.name !== 'string' || !message.name.trim()) {
        return '`event.name` must be a non-empty string.';
      }
      return '';
    case 'dispose':
      return '';
    default:
      return '';
  }
}

function postWorkerMessage(message: any) {
  (self as unknown as Worker).postMessage(message);
}

function emitResult(result: any) {
  if (!result) return;
  if (Object.prototype.hasOwnProperty.call(result, 'model')) {
    postWorkerMessage({ type: 'renderModel', model: result.model });
  }
  if (result.status) {
    postWorkerMessage({ type: 'status', ...result.status });
  }
  if (result.emit) {
    postWorkerMessage({ type: 'emit', ...result.emit });
  }
  if (Array.isArray(result.emits)) {
    for (const entry of result.emits) {
      postWorkerMessage({ type: 'emit', ...entry });
    }
  }
}

export function defineMeridianWorker({
  init,
  update,
  dispose,
}: {
  init?: (payload: any, ctx: any) => Promise<any> | any;
  update?: (state: any, message: any, ctx: any) => Promise<any> | any;
  dispose?: (state: any, ctx: any) => Promise<any> | any;
} = {}) {
  let state: any;
  const ctx = {
    postRenderModel(model: any) {
      postWorkerMessage({ type: 'renderModel', model });
    },
    postStatus(level: string, message: string) {
      postWorkerMessage({ type: 'status', level, message });
    },
    emit(name: string, detail: any = {}) {
      postWorkerMessage({ type: 'emit', name, detail });
    },
  };
  (self as unknown as Worker).addEventListener('message', async (event: MessageEvent) => {
    const message = event.data || {};
    const validationError = validateWorkerMessage(message);
    if (validationError) {
      ctx.postStatus('error', validationError);
      return;
    }

    try {
      if (message.type === 'dispose') {
        await dispose?.(state, ctx);
        (self as unknown as DedicatedWorkerGlobalScope).close();
        return;
      }

      let result = null;
      if (message.type === 'init') {
        result = await init?.(message.payload || {}, ctx);
      } else {
        result = await update?.(state, message, ctx);
      }

      if (result && Object.prototype.hasOwnProperty.call(result, 'state')) {
        state = result.state;
      }
      emitResult(result);
    } catch (error: any) {
      ctx.postStatus('error', error?.message || String(error));
    }
  });
}
