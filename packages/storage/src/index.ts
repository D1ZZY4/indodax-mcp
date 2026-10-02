export interface Repository<T> {
  load(id: string): Promise<T | null>;
  save(id: string, value: T): Promise<void>;
  list(): Promise<T[]>;
  remove(id: string): Promise<boolean>;
}

export class MemoryRepository<T> implements Repository<T> {
  private readonly store = new Map<string, T>();

  async load(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async save(id: string, value: T): Promise<void> {
    this.store.set(id, value);
  }

  async list(): Promise<T[]> {
    return [...this.store.values()];
  }

  async remove(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}
