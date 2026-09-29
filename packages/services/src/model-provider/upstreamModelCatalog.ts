import {
  buildUpstreamModelsRequest,
  parseUpstreamModelsResponse,
  resolveUpstreamApiKey,
} from "@zcode/provider";
import type {
  ProviderConfigObject,
  ProviderSettingsFacade,
  ProviderId,
} from "@zcode/provider";
import type { UpstreamModelCatalogResult } from "@zcode/shared";

export type UpstreamModelCatalogFetcher = (
  providerId: ProviderId,
) => Promise<UpstreamModelCatalogResult>;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 从 Provider 的上游拉取模型目录（`GET /v1/models`）。
 * Provider 配置来自 Registry 的有效视图（builtin.overlay(account).overlay(personal)），
 * api-key 型 access 直接用配置内密钥；账号型（OAuth 权益）没有可复用的静态密钥，
 * 显式报 unsupported-access 而不是静默空列表。
 */
export function createUpstreamModelCatalogFetcher(deps?: {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): (input: {
  readonly api: ProviderConfigObject["api"];
  readonly access: ProviderConfigObject["access"];
}) => Promise<UpstreamModelCatalogResult> {
  const fetchImpl = deps?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (input) => {
    try {
      if (!input.api?.baseUrl?.trim()) {
        return {
          success: false,
          error: {
            code: "api-not-configured",
            message: "该 Provider 未配置 API Base URL，无法从上游获取模型列表",
          },
        };
      }
      const apiKey = input.access ? resolveUpstreamApiKey(input.access) : undefined;
      if (!apiKey && input.access?.type === "zhipu-account") {
        return {
          success: false,
          error: {
            code: "unsupported-access",
            message: "账号型供应商由官方维护模型列表，不支持从上游拉取",
          },
        };
      }
      const { url, headers } = buildUpstreamModelsRequest({ api: input.api, apiKey });
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers,
          signal: abortController.signal,
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 300);
          return {
            success: false,
            error: {
              code: "upstream-error",
              message: `上游返回 ${response.status}${detail ? `：${detail}` : ""}`,
            },
          };
        }
        const payload = await response.json();
        const models = parseUpstreamModelsResponse({
          apiType: input.api.type,
          payload,
        });
        return { success: true, models };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `上游模型列表请求超时（${timeoutMs} ms）`
          : error instanceof Error
            ? error.message
            : String(error);
      return { success: false, error: { code: "upstream-error", message } };
    }
  };
}

/**
 * 服务面入口：按 providerId 在设置视图里定位 Provider，再交给目录 fetcher。
 * 视图里的 effectiveConfig 是 Registry 执行用的合并配置（含 access 密钥），
 * 与连通性测试看到的资格一致。
 */
export function createProviderSettingsUpstreamModelFetcher(
  facade: ProviderSettingsFacade,
  deps?: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number },
): UpstreamModelCatalogFetcher {
  const fetchCatalog = createUpstreamModelCatalogFetcher(deps);
  return async (providerId) => {
    const provider = facade.getView().providers.find((item) => item.providerId === providerId);
    if (!provider) {
      return {
        success: false,
        error: { code: "provider-missing", message: `Provider 不存在: ${providerId}` },
      };
    }
    return await fetchCatalog({
      api: provider.effectiveConfig.api,
      access: provider.effectiveConfig.access,
    });
  };
}
