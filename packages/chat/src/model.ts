// ConversationModel — the renderer-neutral streaming model. Ingests
// ConversationEvents (dedup by seq, upsert blocks by blockId in arrival order,
// track the transient status + last error) and exposes an ordered block list.
// The React tier drives its state from this; the vanilla web component keeps its
// own DOM upsert but shares the same semantics.

import { isActiveStatus, type Block, type ConversationEvent, type Status } from "./wire.js";

function seqNumber(seq: number | string | undefined): number | undefined {
  if (seq === undefined) return undefined;
  const n = typeof seq === "number" ? seq : Number(seq);
  return Number.isNaN(n) ? undefined : n;
}

export class ConversationModel {
  private order: string[] = [];
  private byId = new Map<string, Block>();
  private seen = new Set<number>();
  private status: Status | null = null;
  private error: string | null = null;

  /**
   * Apply one event. Returns true if it changed state, false if it was a
   * duplicate (already-seen seq) and was ignored.
   */
  ingest(ev: ConversationEvent): boolean {
    const seq = seqNumber(ev.seq);
    if (seq !== undefined) {
      if (this.seen.has(seq)) return false;
      this.seen.add(seq);
    }
    if (ev.block) {
      const id = ev.block.blockId ?? "";
      if (!this.byId.has(id)) this.order.push(id);
      this.byId.set(id, ev.block);
    } else if (ev.status) {
      this.status = isActiveStatus(ev.status.state) ? ev.status : null;
    } else if (ev.done) {
      this.status = null;
    } else if (ev.error) {
      this.error = ev.error.message ?? "";
      this.status = null;
    }
    return true;
  }

  /** Blocks in arrival order (each the latest version for its blockId). */
  get blocks(): Block[] {
    const out: Block[] = [];
    for (const id of this.order) {
      const b = this.byId.get(id);
      if (b) out.push(b);
    }
    return out;
  }

  /** The current live status, or null when idle/cleared. */
  get status_(): Status | null {
    return this.status;
  }

  /** The last turn error, or null. */
  get error_(): string | null {
    return this.error;
  }

  reset(): void {
    this.order = [];
    this.byId.clear();
    this.seen.clear();
    this.status = null;
    this.error = null;
  }
}
