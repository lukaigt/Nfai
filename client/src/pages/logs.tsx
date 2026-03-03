import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";

export default function Logs() {
  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/logs"],
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-logs-title">Execution Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">Recent agent activity across all tasks</p>
      </div>

      {(!logs || logs.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center" data-testid="text-no-logs">
            <ScrollText className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No execution logs yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Logs will appear here when the agent starts executing tasks.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="flex-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{logs.length} log entries</CardTitle>
          </CardHeader>
          <CardContent className="h-[calc(100vh-250px)]">
            <ScrollArea className="h-full">
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log: any) => (
                  <div
                    key={log.id}
                    className={`p-2 rounded ${
                      log.status === "failure" ? "bg-destructive/10" :
                      log.status === "success" ? "bg-muted/30" : "bg-muted/20"
                    }`}
                    data-testid={`log-line-${log.id}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">Task #{log.taskId}</Badge>
                      <LogStatusIndicator status={log.status} />
                      <span className="font-medium">{log.action}</span>
                      {log.toolUsed && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{log.toolUsed}</Badge>
                      )}
                      {log.tokenCount > 0 && (
                        <span className="text-muted-foreground ml-auto">{log.tokenCount} tokens</span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 break-all whitespace-pre-wrap">
                      {log.detail?.substring(0, 400)}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogStatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: "bg-status-online",
    failure: "bg-status-busy",
    info: "bg-primary",
    warning: "bg-status-away",
  };
  return <div className={`h-1.5 w-1.5 rounded-full ${colors[status] || "bg-muted-foreground"}`} />;
}
