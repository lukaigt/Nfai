import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Save, TestTube, Wifi, WifiOff, RefreshCw, Search, Check } from "lucide-react";

interface AIModel {
  id: string;
  name: string;
  inputCost: number;
  outputCost: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterUrl, setOpenrouterUrl] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("deepseek/deepseek-chat-v3-0324");
  const [modelSearch, setModelSearch] = useState("");
  const [showModelList, setShowModelList] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [allowedUsers, setAllowedUsers] = useState("");

  const { data: settings, isLoading } = useQuery<any[]>({
    queryKey: ["/api/settings"],
  });

  const { data: models } = useQuery<AIModel[]>({
    queryKey: ["/api/ai/models"],
  });

  const { data: telegramStatus } = useQuery<any>({
    queryKey: ["/api/telegram/status"],
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (settings) {
      const getVal = (key: string, fallback: string) => {
        const s = settings.find((s: any) => s.key === key);
        return s ? (s.value.startsWith("***") ? "" : s.value) : fallback;
      };
      setOpenrouterUrl(getVal("openrouter_base_url", "https://openrouter.ai/api/v1"));
      setModel(getVal("ai_model", "deepseek/deepseek-chat-v3-0324"));
      setAllowedUsers(getVal("telegram_allowed_users", ""));
    }
  }, [settings]);

  const filteredModels = useMemo(() => {
    if (!models) return [];
    if (!modelSearch) return models;
    const q = modelSearch.toLowerCase();
    return models.filter(m =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [models, modelSearch]);

  const selectedModelInfo = useMemo(() => {
    return models?.find(m => m.id === model);
  }, [models, model]);

  function formatCost(cost: number): string {
    const perMillion = cost * 1000000;
    if (perMillion < 0.01) return "free";
    return `$${perMillion.toFixed(2)}/M`;
  }

  const saveMutation = useMutation({
    mutationFn: (settingsArr: { key: string; value: string }[]) =>
      apiRequest("POST", "/api/settings/bulk", { settings: settingsArr.filter(s => s.value) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testAiMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/test", {
        apiKey: openrouterKey || undefined,
        baseUrl: openrouterUrl || undefined,
        model: model || undefined,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "Connected!", description: `Model: ${data.model}` });
      } else {
        toast({ title: "Connection Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const telegramStartMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/telegram/start");
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      if (data.success) {
        toast({ title: "Telegram bot started" });
      } else {
        toast({ title: "Failed to start Telegram bot", description: data.error || "", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const telegramStopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/telegram/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      toast({ title: "Telegram bot stopped" });
    },
  });

  function handleSave() {
    const toSave = [
      { key: "ai_model", value: model },
      { key: "openrouter_base_url", value: openrouterUrl },
      { key: "telegram_allowed_users", value: allowedUsers },
    ];
    if (openrouterKey) toSave.push({ key: "openrouter_api_key", value: openrouterKey });
    if (telegramToken) toSave.push({ key: "telegram_bot_token", value: telegramToken });
    saveMutation.mutate(toSave);
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {[1, 2].map(i => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  const hasApiKey = settings?.some((s: any) => s.key === "openrouter_api_key");
  const hasTelegramToken = settings?.some((s: any) => s.key === "telegram_bot_token");

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your agent's AI provider and Telegram connection</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Provider (OpenRouter)</CardTitle>
          <CardDescription>Configure the AI model that powers the agent's reasoning</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder={hasApiKey ? "Key configured (enter new to update)" : "sk-or-..."}
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                data-testid="input-openrouter-key"
              />
              {hasApiKey && <Badge variant="default">Set</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">Get your key at openrouter.ai/keys</p>
          </div>

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              placeholder="https://openrouter.ai/api/v1"
              value={openrouterUrl}
              onChange={(e) => setOpenrouterUrl(e.target.value)}
              data-testid="input-openrouter-url"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Model</Label>
            <div className="relative">
              <div
                className="flex items-center justify-between border rounded-md px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setShowModelList(!showModelList)}
                data-testid="select-model"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm truncate block">{model}</span>
                  {selectedModelInfo && (
                    <span className="text-xs text-muted-foreground">
                      {selectedModelInfo.name !== selectedModelInfo.id && selectedModelInfo.name}
                      {" "}({formatCost(selectedModelInfo.inputCost)} in / {formatCost(selectedModelInfo.outputCost)} out)
                    </span>
                  )}
                </div>
                <Search className="h-4 w-4 ml-2 text-muted-foreground shrink-0" />
              </div>

              {showModelList && (
                <div className="absolute z-50 w-full mt-1 border rounded-md bg-popover shadow-lg">
                  <div className="p-2 border-b">
                    <Input
                      placeholder="Search models... (e.g. deepseek, gpt, claude)"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      data-testid="input-model-search"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {filteredModels.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        No models found. Try a different search.
                      </div>
                    )}
                    {filteredModels.slice(0, 100).map((m) => (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent text-sm ${model === m.id ? "bg-accent" : ""}`}
                        onClick={() => {
                          setModel(m.id);
                          setShowModelList(false);
                          setModelSearch("");
                        }}
                        data-testid={`model-option-${m.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.id}</span>
                          {m.name !== m.id && (
                            <span className="block truncate text-xs text-muted-foreground">{m.name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatCost(m.inputCost)} in
                          </span>
                          {model === m.id && <Check className="h-4 w-4 text-primary" />}
                        </div>
                      </div>
                    ))}
                    {filteredModels.length > 100 && (
                      <div className="p-2 text-xs text-center text-muted-foreground border-t">
                        Showing first 100 of {filteredModels.length} results. Narrow your search.
                      </div>
                    )}
                  </div>
                  <div className="p-2 border-t">
                    <Input
                      placeholder="Or type any model ID manually..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.target as HTMLInputElement).value) {
                          setModel((e.target as HTMLInputElement).value);
                          setShowModelList(false);
                          setModelSearch("");
                        }
                      }}
                      data-testid="input-custom-model"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Press Enter to use a custom model ID</p>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {models ? `${models.length} models available` : "Loading models..."} — Browse all at openrouter.ai/models
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => testAiMutation.mutate()}
              disabled={testAiMutation.isPending}
              data-testid="button-test-ai"
            >
              <TestTube className="h-4 w-4 mr-1" />
              {testAiMutation.isPending ? "Testing..." : "Test Connection"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-ai"
            >
              <Save className="h-4 w-4 mr-1" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telegram Bot</CardTitle>
          <CardDescription>Connect the agent to Telegram for receiving commands</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Bot Token</Label>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder={hasTelegramToken ? "Token configured (enter new to update)" : "123456789:ABCdef..."}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                data-testid="input-telegram-token"
              />
              {hasTelegramToken && <Badge variant="default">Set</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">Get a token from @BotFather on Telegram</p>
          </div>

          <div className="space-y-1.5">
            <Label>Allowed Users (Optional)</Label>
            <Input
              placeholder="Chat IDs or usernames, comma separated"
              value={allowedUsers}
              onChange={(e) => setAllowedUsers(e.target.value)}
              data-testid="input-allowed-users"
            />
            <p className="text-xs text-muted-foreground">Leave empty to allow all users. Use /id command in Telegram to get your chat ID.</p>
          </div>

          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${telegramStatus?.running ? "bg-status-online" : "bg-status-offline"}`} />
            <span className="text-sm" data-testid="text-telegram-status">
              {telegramStatus?.running ? "Bot is running" : "Bot is stopped"}
            </span>
          </div>

          <div className="flex gap-2">
            {telegramStatus?.running ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => telegramStopMutation.mutate()}
                  disabled={telegramStopMutation.isPending}
                  data-testid="button-telegram-stop"
                >
                  <WifiOff className="h-4 w-4 mr-1" />Stop Bot
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => telegramStartMutation.mutate()}
                  disabled={telegramStartMutation.isPending}
                  data-testid="button-telegram-restart"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />Restart
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => telegramStartMutation.mutate()}
                disabled={telegramStartMutation.isPending}
                data-testid="button-telegram-start"
              >
                <Wifi className="h-4 w-4 mr-1" />
                {telegramStartMutation.isPending ? "Starting..." : "Start Bot"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Button
        onClick={handleSave}
        disabled={saveMutation.isPending}
        className="w-full"
        data-testid="button-save-settings"
      >
        <Save className="h-4 w-4 mr-1" />
        {saveMutation.isPending ? "Saving..." : "Save All Settings"}
      </Button>
    </div>
  );
}
