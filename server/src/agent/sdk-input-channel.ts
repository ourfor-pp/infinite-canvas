import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type PendingRead = { resolve: (value: IteratorResult<SDKUserMessage>) => void; reject: (error: Error) => void };
type QueuedMessage = { message: SDKUserMessage; markConsumed: (consumed: boolean) => void };

export class SdkInputChannel implements AsyncIterable<SDKUserMessage> {
    private queue: QueuedMessage[] = [];
    private pendingReads: PendingRead[] = [];
    private open = true;
    private failure: Error | null = null;
    private iteratorCreated = false;

    constructor(initialMessages: SDKUserMessage[] = []) { initialMessages.forEach((message) => void this.push(message)); }
    isOpen() { return this.open; }
    async append(stream: AsyncIterable<SDKUserMessage>, beforeCommit?: () => void) {
        let message: SDKUserMessage | null = null;
        for await (const item of stream) { if (message) throw new Error("运行中每次只能追加一条 SDK 用户消息"); message = item; }
        if (!message || !this.open) return false;
        beforeCommit?.();
        return this.push(message);
    }
    close() { if (!this.open) return; this.open = false; this.dropQueued(); this.flush(); }
    fail(error: Error) { if (!this.open) return; this.failure = error; this.open = false; this.dropQueued(); this.flush(); }
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        if (this.iteratorCreated) throw new Error("SDK 输入通道只能被消费一次");
        this.iteratorCreated = true;
        return { next: () => this.next(), return: async () => { this.close(); return { done: true, value: undefined }; } };
    }
    private push(message: SDKUserMessage) {
        let markConsumed!: (consumed: boolean) => void;
        const consumed = new Promise<boolean>((resolve) => { markConsumed = resolve; });
        const pending = this.pendingReads.shift();
        if (pending) { pending.resolve({ done: false, value: message }); markConsumed(true); }
        else this.queue.push({ message, markConsumed });
        return consumed;
    }
    private next(): Promise<IteratorResult<SDKUserMessage>> {
        const queued = this.queue.shift();
        if (queued) { queued.markConsumed(true); return Promise.resolve({ done: false, value: queued.message }); }
        if (this.failure) return Promise.reject(this.failure);
        if (!this.open) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve, reject) => this.pendingReads.push({ resolve, reject }));
    }
    private dropQueued() { this.queue.splice(0).forEach((item) => item.markConsumed(false)); }
    private flush() {
        const pending = this.pendingReads.splice(0);
        if (this.failure) pending.forEach(({ reject }) => reject(this.failure!));
        else pending.forEach(({ resolve }) => resolve({ done: true, value: undefined }));
    }
}
