type EventName = string | symbol;
type Listener = (...arguments_: unknown[]) => void;

interface ListenerRecord {
  listener: Listener;
  original: Listener;
  once: boolean;
}

/** Browser-sized Node EventEmitter compatibility for abstract-level. */
export class EventEmitter {
  static defaultMaxListeners = 10;
  #events = new Map<EventName, ListenerRecord[]>();
  #maxListeners = EventEmitter.defaultMaxListeners;

  static listenerCount(emitter: EventEmitter, event: EventName): number {
    return emitter.listenerCount(event);
  }

  setMaxListeners(count: number): this {
    if (!Number.isInteger(count) || count < 0) throw new RangeError("Invalid listener limit");
    this.#maxListeners = count;
    return this;
  }

  getMaxListeners(): number {
    return this.#maxListeners;
  }

  emit(event: EventName, ...arguments_: unknown[]): boolean {
    const records = this.#events.get(event);
    if (!records?.length) {
      if (event === "error") {
        const cause = arguments_[0];
        throw cause instanceof Error ? cause : new Error(String(cause ?? "Unhandled error event"));
      }
      return false;
    }

    for (const record of [...records]) {
      if (record.once) this.removeListener(event, record.original);
      record.listener.apply(this, arguments_);
    }
    return true;
  }

  addListener(event: EventName, listener: Listener): this {
    return this.#add(event, listener, false, false);
  }

  on(event: EventName, listener: Listener): this {
    return this.addListener(event, listener);
  }

  prependListener(event: EventName, listener: Listener): this {
    return this.#add(event, listener, false, true);
  }

  once(event: EventName, listener: Listener): this {
    return this.#add(event, listener, true, false);
  }

  prependOnceListener(event: EventName, listener: Listener): this {
    return this.#add(event, listener, true, true);
  }

  removeListener(event: EventName, listener: Listener): this {
    const records = this.#events.get(event);
    if (!records) return this;
    const index = records.findIndex(
      (record) => record.original === listener || record.listener === listener,
    );
    if (index < 0) return this;
    const [removed] = records.splice(index, 1);
    if (records.length === 0) this.#events.delete(event);
    if (event !== "removeListener" && removed) {
      this.emit("removeListener", event, removed.original);
    }
    return this;
  }

  off(event: EventName, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  removeAllListeners(event?: EventName): this {
    if (event !== undefined) {
      for (const listener of this.listeners(event)) this.removeListener(event, listener);
      return this;
    }
    for (const eventName of this.eventNames()) {
      if (eventName !== "removeListener") this.removeAllListeners(eventName);
    }
    this.#events.delete("removeListener");
    return this;
  }

  listeners(event: EventName): Listener[] {
    return (this.#events.get(event) ?? []).map((record) => record.original);
  }

  rawListeners(event: EventName): Listener[] {
    return (this.#events.get(event) ?? []).map((record) => record.listener);
  }

  listenerCount(event: EventName): number {
    return this.#events.get(event)?.length ?? 0;
  }

  eventNames(): EventName[] {
    return [...this.#events.keys()];
  }

  #add(event: EventName, listener: Listener, once: boolean, prepend: boolean): this {
    if (typeof listener !== "function") throw new TypeError("Listener must be a function");
    if (event !== "newListener") this.emit("newListener", event, listener);
    const records = this.#events.get(event) ?? [];
    const record: ListenerRecord = { listener, original: listener, once };
    if (prepend) records.unshift(record);
    else records.push(record);
    this.#events.set(event, records);
    return this;
  }
}

export const once = (
  emitter: EventEmitter,
  event: EventName,
): Promise<unknown[]> =>
  new Promise((resolve, reject) => {
    const onEvent = (...arguments_: unknown[]) => {
      emitter.removeListener("error", onError);
      resolve(arguments_);
    };
    const onError = (error: unknown) => {
      emitter.removeListener(event, onEvent);
      reject(error);
    };
    emitter.once(event, onEvent);
    if (event !== "error") emitter.once("error", onError);
  });

export default EventEmitter;
