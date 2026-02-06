class CollectorManager {
    constructor(maxPerUser = 1) {
        this.active = new Map(); // userId -> Set of collectors
        this.maxPerUser = maxPerUser;
    }

    canCreate(userId) {
        const userCollectors = this.active.get(userId);
        return !userCollectors || userCollectors.size < this.maxPerUser;
    }

    register(userId, collector) {
        if (!this.active.has(userId)) {
            this.active.set(userId, new Set());
        }
        this.active.get(userId).add(collector);

        collector.on('end', () => {
            this.unregister(userId, collector);
        });
    }

    unregister(userId, collector) {
        const userCollectors = this.active.get(userId);
        if (userCollectors) {
            userCollectors.delete(collector);
            if (userCollectors.size === 0) {
                this.active.delete(userId);
            }
        }
    }
}

module.exports = CollectorManager;
