import type { ProviderApiConfigInput, ProviderAccessConfigObject } from "./provider-config.js";
import type { UpstreamModelSummary } from "@zcode/shared/model-provider-types";

/** 上游模型目录条目的 api 配置形状；baseUrl 可能尚未通过完整校验（Personal 暂存态）。 */
type UpstreamApiConfig = Pick<ProviderApiConfigInput, "type" | "baseUrl" | "headers">;

export type UpstreamModelInfo = UpstreamModelSummary;

export interface UpstreamModelsRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** Anthropic Messages 协议的版本头；与 @ai-sdk/anthropic 缺省值一致。 */
const ANTHROPIC_VERSION_HEADER = "anthropic-version";
const ANTHROPIC_VERSION = "2023-06-01";

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}${path}`;
}

/**
 * 构造 `GET /v1/models` 请求。三种 api.type 都在同一路径上列模型；
 * openai 两类用 Bearer，anthropic-messages 用 x-api-key + anthropic-version。
 * baseUrl 允许调用方自带 `/v1` 后缀（部分自建网关这样配置），此时不再追加。
 */
export function buildUpstreamModelsRequest(input: {
  readonly api: UpstreamApiConfig;
  readonly apiKey?: string;
}): UpstreamModelsRequest {
  const baseUrl = input.api.baseUrl;
  if (!baseUrl?.trim()) {
    throw new Error("Provider 未配置 API Base URL，无法从上游获取模型列表");
  }
  const withV1 = /\/v\d+$/.test(baseUrl.replace(/\/+$/, ""))
    ? baseUrl.replace(/\/+$/, "")
    : joinUrl(baseUrl, "/v1");
  const url = `${withV1}/models`;

  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = input.apiKey?.trim();
  if (input.api.type === "anthropic-messages") {
    headers[ANTHROPIC_VERSION_HEADER] = ANTHROPIC_VERSION;
    if (apiKey) headers["x-api-key"] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  for (const [key, value] of Object.entries(input.api.headers ?? {})) {
    // 自定义头最后覆盖，允许用户按网关要求补鉴权；鉴权名不在此列时原样透传。
    if (key.toLowerCase() !== "authorization" || !headers.Authorization || !apiKey) {
      headers[key] = value;
    }
  }
  return { url, headers };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

/** 上游用来声明上下文长度的字段名各家不一，逐个识别；都没有就放弃预填。 */
const CONTEXT_WINDOW_FIELDS = [
  "context_window",
  "context_length",
  "max_model_len",
  "max_context_length",
  "max_context_tokens",
] as const;

const DISPLAY_NAME_FIELDS = ["display_name", "displayname", "name", "id"] as const;

function parseAnthropicModelEntry(entry: Record<string, unknown>): UpstreamModelInfo | undefined {
  const id = readString(entry.id);
  if (!id) return undefined;
  return {
    id,
    ...(readString(entry.display_name) ? { displayName: readString(entry.display_name) } : {}),
  };
}

function parseOpenAiModelEntry(entry: Record<string, unknown>): UpstreamModelInfo | undefined {
  const id = readString(entry.id);
  if (!id) return undefined;
  let contextWindow: number | undefined;
  for (const field of CONTEXT_WINDOW_FIELDS) {
    contextWindow = readPositiveInt(entry[field]);
    if (contextWindow !== undefined) break;
  }
  let displayName: string | undefined;
  for (const field of DISPLAY_NAME_FIELDS) {
    const value = readString(entry[field]);
    if (value) {
      displayName = field === "id" ? undefined : value;
      break;
    }
  }
  const modalities = Array.isArray(entry.input_modalities)
    ? entry.input_modalities.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    id,
    ...(displayName ? { displayName } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(modalities && modalities.length > 0 ? { inputModalities: modalities } : {}),
  };
}

/**
 * 解析上游 `/v1/models` 响应体。两种协议的响应都是 `{data: [...]}`（anthropic 还有
 * `has_more`/`first_id` 分页字段，这里忽略——设置页候选列表拉一页足够）。
 */
export function parseUpstreamModelsResponse(input: {
  readonly apiType: ProviderApiConfigInput["type"];
  readonly payload: unknown;
}): readonly UpstreamModelInfo[] {
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("上游模型列表响应格式无法识别");
  }
  const data = (input.payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("上游模型列表响应缺少 data 数组");
  }
  const models: UpstreamModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const parsed =
      input.apiType === "anthropic-messages"
        ? parseAnthropicModelEntry(entry as Record<string, unknown>)
        : parseOpenAiModelEntry(entry as Record<string, unknown>);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      models.push(parsed);
    }
  }
  return models;
}

/** 判断 Provider 的 access 类型是否携带可直接用于列表拉取的密钥。 */
export function resolveUpstreamApiKey(access: ProviderAccessConfigObject): string | undefined {
  if (access.type === "zhipu-account") return undefined;
  const apiKey = access.apiKey?.trim();
  return apiKey ? apiKey : undefined;
}
