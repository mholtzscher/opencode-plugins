class Cache<T>(private val values: Map<String, T>) {
    /** Returns the value without mutating the cache. */
    fun get(key: String): T? {
        // Missing keys yield null.
        return values[key]
    }
}

/** Trims surrounding whitespace. */
fun String.normalized(): String = trim()
