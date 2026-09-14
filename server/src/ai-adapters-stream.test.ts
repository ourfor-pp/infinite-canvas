import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { adapterFor, type ProviderContext } from './ai-adapters.js';

test('文本适配器保留上游HTTP错误而非只报没有输出', async () => {
    let mode = "http-error";
    const deltas: string[] = [];
    const server = createServer((_request, response) => {
        if (mode !== "http-error") {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            if (mode === 'stream-error') {
                response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { content: '部分结果' }, finish_reason: null }] })}\n\n`);
                response.end(`data: ${JSON.stringify({ error: { message: 'upstream stopped midstream', type: 'server_error' } })}\n\ndata: [DONE]\n\n`);
                return;
            }
            for (const [content, finish_reason] of [['听到', null], ['脚步声', null], ['', 'stop']] as const) {
                response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`);
            }
            response.end('data: [DONE]\n\n');
            return;
        }
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Audio decode failed: invalid WAV header', type: 'invalid_request_error' } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const context = {
        row: { id: 'test', type: 'custom', base_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` },
        credentials: { apiKey: 'test-key' }, model: { id: 'test', endpoint: 'openai-chat' },
        userId: 'test-user', request: { kind: 'text', prompt: 'local test' }, signal: AbortSignal.timeout(5000),
        onDelta: (delta: string) => deltas.push(delta), onRemoteTask: () => {}, onProgress: () => {},
    } as unknown as ProviderContext;
    try {
        await assert.rejects(adapterFor('openai-chat').generateText!(context), (error: Error & { statusCode?: number }) => {
            assert.match(error.message, /invalid WAV header/);
            assert.equal(error.statusCode, 400);
            return true;
        });
        mode = "success";
        const result = await adapterFor('openai-chat').generateText!(context);
        assert.equal(result.text, '听到脚步声');
        assert.equal(deltas.join(''), result.text);
        assert.equal(result.finishReason, 'stop');
        mode = 'stream-error';
        await assert.rejects(adapterFor('openai-chat').generateText!(context), /upstream stopped midstream/);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
