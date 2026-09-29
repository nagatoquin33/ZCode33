import { useState } from "react";
import { CloudDownloadIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { cn } from "@/components/lib/utils.js";
import type { UpstreamModelCatalogResult, UpstreamModelSummary } from "@zcode/shared";

/**
 * 添加/编辑模型弹窗里的上游候选：拉取 `GET /v1/models` 目录并按需回填表单。
 * 拉取失败或上游不支持时只展示错误，手填路径始终保留。
 */
export function UpstreamModelPicker({
  providerId,
  disabled = false,
  onModelSelected,
}: {
  providerId: string;
  disabled?: boolean;
  onModelSelected: (model: UpstreamModelSummary) => void;
}) {
  const { intl } = useZCodeIntl();
  const { providerSettingsService } = useServices();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UpstreamModelCatalogResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fetchModels = async () => {
    if (loading || disabled) return;
    setLoading(true);
    try {
      const catalog = await providerSettingsService.fetchUpstreamModels(providerId);
      setResult(catalog);
      if (catalog.success && catalog.models.length > 0) setPickerOpen(true);
    } catch (error) {
      setResult({
        success: false,
        error: {
          code: "upstream-error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const selectModel = (model: UpstreamModelSummary) => {
    setPickerOpen(false);
    onModelSelected(model);
  };

  const models = result?.success ? result.models : [];
  const errorMessage =
    result && !result.success
      ? intl.formatMessage(
          { id: "settings.modelProvider.fetchUpstreamModelsFailed" },
          { message: result.error.message },
        )
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-1" data-upstream-model-picker="true">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          onClick={() => void fetchModels()}
        >
          {loading ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <CloudDownloadIcon className="size-3.5" aria-hidden="true" />
          )}
          {intl.formatMessage({ id: "settings.modelProvider.fetchUpstreamModels" })}
        </Button>
        {result?.success && models.length > 0 ? (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={disabled}>
                {intl.formatMessage(
                  { id: "settings.modelProvider.upstreamModelsCount" },
                  { count: models.length },
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.upstreamModelPickerPlaceholder",
                  })}
                />
                <CommandList>
                  <CommandEmpty>
                    {intl.formatMessage({ id: "settings.modelProvider.upstreamModelEmpty" })}
                  </CommandEmpty>
                  <CommandGroup>
                    {models.map((model) => (
                      <CommandItem
                        key={model.id}
                        value={`${model.displayName ?? ""} ${model.id}`}
                        onSelect={() => selectModel(model)}
                        className="font-mono text-ui-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">{model.id}</span>
                        {model.displayName && model.displayName !== model.id ? (
                          <span className="shrink-0 font-sans text-foreground-subtlest">
                            {model.displayName}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {errorMessage ? (
        <p className={cn("text-ui-sm text-destructive")} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
