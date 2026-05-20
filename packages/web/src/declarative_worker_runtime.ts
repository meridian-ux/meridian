import {
  MeridianAction,
  MeridianDeclarativeContract,
  MeridianEffect,
} from './types/global.js';

export function defineDeclarativeMeridianWorker(contract: MeridianDeclarativeContract) {
  let state = contract.initialState ? { ...contract.initialState } : {};
  const transitions = contract.transitions || {};

  const ctx = {
    postRenderModel(model: any) {
      (self as unknown as Worker).postMessage({ type: 'renderModel', model });
    },
    postStatus(level: string, message: string) {
      (self as unknown as Worker).postMessage({ type: 'status', level, message });
    },
    emit(name: string, detail: any = {}) {
      (self as unknown as Worker).postMessage({ type: 'emit', name, detail });
    },
    getState() {
      return state;
    },
    setState(next: Record<string, any>) {
      state = { ...state, ...next };
    },
  };

  async function handleAction(action: MeridianAction) {
    const effects = transitions[action.type];
    if (!effects) return;
    for (const effect of effects) {
      await runEffect(effect, action);
    }
  }

  async function runEffect(effect: MeridianEffect, triggeringAction: MeridianAction) {
    switch (effect.effect) {
      case 'fetch': {
        try {
          const url = interpolate(effect.params?.url, triggeringAction);
          const body = interpolate(effect.params?.body, triggeringAction);
          const res = await fetch(url, { method: 'POST', body });
          const result = await res.json();
          if (effect.onSuccess) {
            for (const act of effect.onSuccess) {
              await handleAction(resolveAction(act, { result }));
            }
          }
        } catch (error) {
          if (effect.onError) {
            for (const act of effect.onError) {
              await handleAction(resolveAction(act, { error }));
            }
          }
        }
        break;
      }
      case 'setState': {
        const next: Record<string, any> = {};
        for (const k in effect.params) {
          next[k] = interpolate(effect.params[k], triggeringAction);
        }
        ctx.setState(next);
        break;
      }
      case 'postMessage': {
        const msg: Record<string, any> = {};
        for (const k in effect.params) {
          msg[k] = interpolate(effect.params[k], triggeringAction);
        }
        (self as unknown as Worker).postMessage(msg);
        break;
      }
      default:
        ctx.postStatus('warn', `Unknown effect: ${effect.effect}`);
    }
  }

  function interpolate(val: any, action: MeridianAction): any {
    if (typeof val !== 'string') return val;
    return val.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      if (expr.startsWith('payload.')) {
        return action.payload?.[expr.slice(8)] ?? '';
      }
      if (expr === 'payload') return JSON.stringify(action.payload ?? '');
      if (expr === 'result' && (action as any).result !== undefined)
        return JSON.stringify((action as any).result);
      if (expr === 'error' && (action as any).error !== undefined)
        return String((action as any).error);
      return '';
    });
  }

  function resolveAction(
    action: MeridianAction,
    context: { result?: any; error?: any },
  ): MeridianAction {
    const out: MeridianAction = { ...action };
    if (context?.result !== undefined) {
      out.payload = context.result;
      (out as any).result = context.result;
    }
    if (context?.error !== undefined) {
      out.payload = context.error;
      (out as any).error = context.error;
    }
    return out;
  }

  (self as unknown as Worker).addEventListener('message', async (event: MessageEvent) => {
    const message = event.data || {};
    if (message.type === 'dispose') {
      (self as unknown as DedicatedWorkerGlobalScope).close();
      return;
    }
    if (message.type === 'init' && message.payload?.contract) {
      Object.assign(contract, message.payload.contract);
      state = contract.initialState ? { ...contract.initialState } : {};
      ctx.postStatus('info', 'Declarative worker initialized.');
      return;
    }
    if (message.type === 'event' && message.name) {
      await handleAction({ type: message.name, payload: message.payload });
    }
  });
}
