import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { SdkInputChannel } from "./sdk-input-channel.js";

const message = (text: string) => ({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text }] } }) as SDKUserMessage;

test("SDK 输入通道消费首条消息后仍可追加 steer", async () => {
        const channel = new SdkInputChannel([message("初始")]);
        const iterator = channel[Symbol.asyncIterator]();
        assert.equal(((await iterator.next()).value?.message.content[0] as { text: string }).text, "初始");
        const next = iterator.next();
        const appended = channel.append((async function* () { yield message("调整"); })());
        assert.equal((((await next).value?.message.content[0]) as { text: string }).text, "调整");
        assert.equal(await appended, true);
        channel.close();
});

test("SDK 输入通道关闭时丢弃未消费输入", async () => {
        const channel = new SdkInputChannel();
        const append = channel.append((async function* () { yield message("未消费"); })());
        await Promise.resolve();
        channel.close();
        assert.equal(await append, false);
});
