import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, KeyRound, Eye, EyeOff } from "lucide-react";

export default function Credentials() {
  const [addOpen, setAddOpen] = useState(false);
  const [platform, setPlatform] = useState("");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const { data: credentials, isLoading } = useQuery<any[]>({
    queryKey: ["/api/credentials"],
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/credentials", { platform, label, username, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      setAddOpen(false);
      setPlatform("");
      setLabel("");
      setUsername("");
      setPassword("");
      toast({ title: "Credential added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/credentials/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/credentials"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/credentials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Credential deleted" });
    },
  });

  const platforms = ["reddit", "twitter", "instagram", "facebook", "email", "github", "discord", "custom"];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-credentials-title">Credentials</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage platform accounts for the agent</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-credential"><Plus className="h-4 w-4 mr-1" />Add Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Credential</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Platform</label>
                <div className="flex flex-wrap gap-1.5">
                  {platforms.map(p => (
                    <Badge
                      key={p}
                      variant={platform === p ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => setPlatform(p)}
                      data-testid={`badge-platform-${p}`}
                    >
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
              <Input
                placeholder="Label (e.g. Main Reddit Account)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                data-testid="input-credential-label"
              />
              <Input
                placeholder="Username or Email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                data-testid="input-credential-username"
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-credential-password"
              />
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!platform || !username || !password || createMutation.isPending}
                className="w-full"
                data-testid="button-submit-credential"
              >
                {createMutation.isPending ? "Adding..." : "Add Credential"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(!credentials || credentials.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center" data-testid="text-no-credentials">
            <KeyRound className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No credentials stored yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Add platform accounts so the agent can use them.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {credentials.map((cred: any) => (
            <Card key={cred.id} className={!cred.isActive ? "opacity-50" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" data-testid={`badge-cred-platform-${cred.id}`}>{cred.platform}</Badge>
                    <span className="text-sm font-medium truncate" data-testid={`text-cred-label-${cred.id}`}>{cred.label}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={cred.isActive}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: cred.id, isActive: checked })}
                      data-testid={`switch-cred-active-${cred.id}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(cred.id)}
                      data-testid={`button-delete-cred-${cred.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span data-testid={`text-cred-username-${cred.id}`}>Username: {cred.username}</span>
                  <span className="ml-3">Password: ***</span>
                </div>
                {cred.lastUsedAt && (
                  <p className="text-xs text-muted-foreground mt-1">Last used: {new Date(cred.lastUsedAt).toLocaleString()}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
