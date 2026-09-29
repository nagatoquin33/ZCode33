import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpstreamModelsRequest,
  parseUpstreamModelsResponse,
  resolveUpstreamApiKey,
} from "@zcode/provider";
import { createUpstreamModelCatalogFetcher } from "../src/model-provider/upstreamModelCatalog.js";

test("buildUpstreamModelsRequest 对 openai 协议使用 Bearer 并追加 /v1/models", () => {
  const request = buildUpstreamModelsRequest({
    api: { type: "openai-chat-completions", baseUrl: "https://api.example.com" },
    apiKey: "sk-test",
  });
  assert.equal(request.url, "https://api.example.com/v1/models");
  assert.equal(request.headers.Authorization, "Bearer sk-test");
});

test("buildUpstreamModelsRequest 对 anthropic 协议使用 x-api-key 与版本头", () => {
  const request = buildUpstreamModelsRequest({
    api: { type: "anthropic-messages", baseUrl: "https://api.example.com/v1/" },
    apiKey: "ak-test",
  });
  assert.equal(request.url, "https://api.example.com/v1/models");
  assert.equal(request.headers["x-api-key"], "ak-test");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.headers.Authorization, undefined);
});

test("buildUpstreamModelsRequest 保留 baseUrl 末尾的版本段并不追加重复 /v1", () => {
  const request = buildUpstreamModelsRequest({
    api: { type: "openai-responses", baseUrl: "https://gateway.example.com/v2" },
  });
  assert.equal(request.url, "https://gateway.example.com/v2/models");
});

test("parseUpstreamModelsResponse 识别 openai 兼容服务器的上下文长度字段", () => {
  const models = parseUpstreamModelsResponse({
    apiType: "openai-chat-completions",
    payload: {
      data: [
        { id: "model-a", context_length: 131072 },
        { id: "model-b", max_model_len: "8192", display_name: "Model B" },
        { id: "model-a", context_length: 1 },
        { not_a_model: true },
      ],
    },
  });
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], { id: "model-a", contextWindow: 131072 });
  assert.deepEqual(models[1], {
    id: "model-b",
    displayName: "Model B",
    contextWindow: 8192,
  });
});

test("parseUpstreamModelsResponse 解析 anthropic 目录并忽略分页字段", () => {
  const models = parseUpstreamModelsResponse({
    apiType: "anthropic-messages",
    payload: {
      data: [
        { id: "claude-x", display_name: "Claude X", type: "model" },
        { id: "claude-y", type: "model" },
      ],
      has_more: true,
      first_id: "claude-x",
    },
  });
  assert.equal(models.length, 2);
  assert.equal(models[0]?.displayName, "Claude X");
  assert.equal(models[1]?.displayName, undefined);
});

test("parseUpstreamModelsResponse 拒绝无法识别的响应体", () => {
  assert.throws(() => parseUpstreamModelsResponse({ apiType: "openai-chat-completions", payload: {} }));
  assert.throws(() =>
    parseUpstreamModelsResponse({ apiType: "openai-chat-completions", payload: { data: "nope" } }),
  );
});

test("resolveUpstreamApiKey 账号型 access 不提供静态密钥", () => {
  assert.equal(
    resolveUpstreamApiKey({ type: "api-key", apiKey: " sk-x " }),
    "sk-x",
  );
  assert.equal(
    resolveUpstreamApiKey({ type: "zhipu-account", accountType: "zai", mode: "start-plan", entitled: true }),
    undefined,
  );
});

test("createUpstreamModelCatalogFetcher 拉取成功返回归一化模型列表", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: [{ id: "m-1", context_length: 4096 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const fetcher = createUpstreamModelCatalogFetcher({ fetchImpl });
  const result = await fetcher({
    api: { type: "openai-chat-completions", baseUrl: "https://api.example.com" },
    access: { type: "api-key", apiKey: "sk-test" },
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.models, [{ id: "m-1", contextWindow: 4096 }]);
  }
});

test("createUpstreamModelCatalogFetcher 把上游错误映射为失败结果", async () => {
  const fetchImpl = (async () =>
    new Response("denied", { status: 401 })) as typeof fetch;
  const fetcher = createUpstreamModelCatalogFetcher({ fetchImpl });
  const result = await fetcher({
    api: { type: "openai-chat-completions", baseUrl: "https://api.example.com" },
    access: { type: "api-key", apiKey: "sk-test" },
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, "upstream-error");
    assert.match(result.error.message, /401/);
  }
});

test("createUpstreamModelCatalogFetcher 对未配置 baseUrl 与账号型 access 显式报错", async () => {
  const fetcher = createUpstreamModelCatalogFetcher({
    fetchImpl: (async () => {
      throw new Error("should not fetch");
    }) as typeof fetch,
  });
  const noApi = await fetcher({ api: undefined, access: { type: "api-key", apiKey: "k" } });
  assert.equal(noApi.success, false);
  if (!noApi.success) assert.equal(noApi.error.code, "api-not-configured");

  const account = await fetcher({
    api: { type: "openai-chat-completions", baseUrl: "https://api.example.com" },
    access: { type: "zhipu-account", accountType: "zai", mode: "start-plan", entitled: true },
  });
  assert.equal(account.success, false);
  if (!account.success) assert.equal(account.error.code, "unsupported-access");
});
