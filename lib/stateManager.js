class StateManager {
    constructor() {
        this.states = new Map();
        // Очистка каждые 5 минут
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    /**
     * @param {string} key 
     * @param {any} value 
     * @param {number} ttl Time to live in ms (default 10 min)
     */
    set(key, value, ttl = 10 * 60 * 1000) {
        this.states.set(key, {
            data: value,
            expiresAt: Date.now() + ttl
        });
    }

    get(key) {
        const entry = this.states.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.states.delete(key);
            return null;
        }

        return entry.data;
    }

    delete(key) {
        return this.states.delete(key);
    }

    has(key) {
        const entry = this.states.get(key);
        if (!entry) return false;
        if (Date.now() > entry.expiresAt) {
            this.states.delete(key);
            return false;
        }
        return true;
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.states.entries()) {
            if (now > entry.expiresAt) {
                this.states.delete(key);
            }
        }
    }

    destroy() {
        clearInterval(this.cleanupInterval);
        this.states.clear();
    }
}

// Экспортируем синглтон, чтобы состояние было общим в рамках модуля (если нужно)
// Но так как у нас разные модули, лучше экспортировать класс или просто использовать new StateManager в каждом модуле.
// Для простоты использования в текущей архитектуре (где pendingRequests разбросаны)
// мы будем создавать инстансы в каждом файле.
module.exports = StateManager;
