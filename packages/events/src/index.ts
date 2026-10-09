import type { DomainEvent } from "@d1zzy4-jethools/core";

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<DomainEvent["kind"], Set<EventHandler>>();
  private readonly wildcards = new Set<EventHandler>();

  on(kind: DomainEvent["kind"], handler: EventHandler): () => void {
    let set = this.handlers.get(kind);
    if (!set) {
      set = new Set();
      this.handlers.set(kind, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  onAny(handler: EventHandler): () => void {
    this.wildcards.add(handler);
    return () => {
      this.wildcards.delete(handler);
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    const targets = [...(this.handlers.get(event.kind) ?? []), ...this.wildcards];
    await Promise.all(targets.map((handler) => handler(event)));
  }
}
