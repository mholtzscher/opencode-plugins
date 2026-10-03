export class Cache<T> {
  private readonly values = new Map<string, T>();

  /** Returns the value without mutating the cache. */
  get(key: string): T | undefined {
    // Missing keys yield undefined.
    return this.values.get(key);
  }
}
