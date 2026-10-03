package cache

// Cache stores values by key.
type Cache[T any] struct {
	values map[string]T
}

// Get returns the value and whether the key exists.
// Missing keys do not mutate the cache.
func (c *Cache[T]) Get(key string) (T, bool) {
	// A map lookup preserves the presence flag.
	value, ok := c.values[key]
	return value, ok
}

func unrelated() string { return "not selected" }
