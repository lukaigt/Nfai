import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Save, TestTube, Wifi, WifiOff, RefreshCw } from "lucide-react";

export default function SettingsPage() {
  const { toast } = useToast();
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterUrl, setOpenrouterUrl] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("deepseek/deepseek-chat-v3-0324");
  const [telegramToken, setTelegramToken] = useState("");
  const [allowedUsers, setAllowedUsers] = useState("");

  const { data: settings, isLoading } = useQuery<any[]>({
    queryKey: ["/api/settings"],
  });

  const { data: models } = useQuery<any[]>({
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
    mutationFn: () => apiRequest("POST", "/api/ai/test"),
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "AI Connected", description: `Model: ${data.model}` });
      } else {
        toast({ title: "Connection Failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const telegramStartMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/telegram/start"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      if (data.success) {
        toast({ title: "Telegram bot started" });
      } else {
        toast({ title: "Failed to start Telegram bot", variant: "destructive" });
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
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger data-testid="select-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models?.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id} (${(m.inputCost * 1000000).toFixed(2)}/M in)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="secondary"
            onClick={() => testAiMutation.mutate()}
            disabled={testAiMutation.isPending}
            data-testid="button-test-ai"
          >
            <TestTube className="h-4 w-4 mr-1" />
            {testAiMutation.isPending ? "Testing..." : "Test Connection"}
          </Button>
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
