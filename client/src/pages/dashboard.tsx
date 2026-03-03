import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListTodo, CheckCircle, XCircle, Loader2, Coins, Cpu } from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/stats"],
    refetchInterval: 5000,
  });

  const { data: tasks } = useQuery<any[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: 5000,
  });

  const recentTasks = tasks?.slice(0, 5) || [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    { label: "Total Tasks", value: stats?.totalTasks || 0, icon: ListTodo, color: "text-primary" },
    { label: "Completed", value: stats?.completedTasks || 0, icon: CheckCircle, color: "text-status-online" },
    { label: "Failed", value: stats?.failedTasks || 0, icon: XCircle, color: "text-status-busy" },
    { label: "Running", value: stats?.runningTasks || 0, icon: Loader2, color: "text-status-away" },
    { label: "Tokens Used", value: (stats?.totalTokens || 0).toLocaleString(), icon: Cpu, color: "text-chart-3" },
    { label: "Total Cost", value: `$${stats?.totalCost || "0.0000"}`, icon: Coins, color: "text-chart-1" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Agent overview and activity</p>
        </div>
        <Badge
          variant={stats?.telegramConnected ? "default" : "secondary"}
          data-testid="badge-telegram-status"
        >
          {stats?.telegramConnected ? "Telegram Connected" : "Telegram Offline"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-1">
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-semibold mt-1" data-testid={`stat-${card.label.toLowerCase().replace(/\s/g, "-")}`}>
                    {card.value}
                  </p>
                </div>
                <card.icon className={`h-5 w-5 ${card.color} opacity-70`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-tasks">
              No tasks yet. Send one from Telegram or create one from the Tasks page.
            </div>
          ) : (
            <div className="space-y-2">
              {recentTasks.map((task: any) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-4 py-2 px-3 rounded-md bg-muted/50"
                  data-testid={`task-row-${task.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleDateString()} - {task.totalTokens} tokens
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default",
    running: "secondary",
    failed: "destructive",
    pending: "outline",
    paused: "outline",
  };
  return (
    <Badge variant={variants[status] || "outline"} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}
