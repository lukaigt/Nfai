import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Play, Square, RotateCcw, Trash2, ChevronRight, X } from "lucide-react";

export default function Tasks() {
  const [newOpen, setNewOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();

  const { data: tasks, isLoading } = useQuery<any[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: 3000,
  });

  const { data: taskDetail } = useQuery<any>({
    queryKey: ["/api/tasks", selectedTask],
    enabled: !!selectedTask,
    refetchInterval: 3000,
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks", { title: title || description.substring(0, 80), description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setNewOpen(false);
      setTitle("");
      setDescription("");
      toast({ title: "Task created and executing" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task cancelled" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/tasks/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task retry started" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setSelectedTask(null);
      toast({ title: "Task deleted" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 flex gap-6 h-full">
      <div className={`flex flex-col gap-4 ${selectedTask ? "w-1/2" : "w-full"} transition-all`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-tasks-title">Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">{tasks?.length || 0} tasks total</p>
          </div>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-task"><Plus className="h-4 w-4 mr-1" />New Task</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder="Task title (optional)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="input-task-title"
                />
                <Textarea
                  placeholder="Describe what you want the agent to do..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[120px]"
                  data-testid="input-task-description"
                />
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!description.trim() || createMutation.isPending}
                  className="w-full"
                  data-testid="button-submit-task"
                >
                  {createMutation.isPending ? "Creating..." : "Create & Execute"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-2">
            {(!tasks || tasks.length === 0) ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground text-sm" data-testid="text-no-tasks">
                  No tasks yet. Create one or send a message via Telegram.
                </CardContent>
              </Card>
            ) : (
              tasks.map((task: any) => (
                <div
                  key={task.id}
                  className={`flex items-center gap-3 p-3 rounded-md cursor-pointer hover-elevate transition-colors ${
                    selectedTask === task.id ? "bg-accent" : "bg-card"
                  }`}
                  onClick={() => setSelectedTask(task.id === selectedTask ? null : task.id)}
                  data-testid={`task-item-${task.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(task.createdAt).toLocaleString()} | {task.totalTokens} tokens | ${task.totalCostUsd}
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {selectedTask && taskDetail && (
        <div className="w-1/2 flex flex-col gap-4">
          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base truncate" data-testid="text-task-detail-title">
                  #{taskDetail.id}: {taskDetail.title}
                </CardTitle>
                <div className="flex items-center gap-1 shrink-0">
                  {taskDetail.status === "running" && (
                    <Button size="icon" variant="ghost" onClick={() => cancelMutation.mutate(taskDetail.id)} data-testid="button-cancel-task">
                      <Square className="h-4 w-4" />
                    </Button>
                  )}
                  {(taskDetail.status === "failed" || taskDetail.status === "paused") && (
                    <Button size="icon" variant="ghost" onClick={() => retryMutation.mutate(taskDetail.id)} data-testid="button-retry-task">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(taskDetail.id)} data-testid="button-delete-task">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setSelectedTask(null)} data-testid="button-close-detail">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <StatusBadge status={taskDetail.status} />
                <span className="text-xs text-muted-foreground">{taskDetail.totalTokens} tokens</span>
                <span className="text-xs text-muted-foreground">${taskDetail.totalCostUsd}</span>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <p className="text-sm text-muted-foreground mb-3">{taskDetail.description}</p>
              {taskDetail.result && (
                <div className="p-3 rounded-md bg-muted/50 mb-3">
                  <p className="text-xs font-medium mb-1">Result:</p>
                  <p className="text-sm whitespace-pre-wrap">{taskDetail.result}</p>
                </div>
              )}
              {taskDetail.error && (
                <div className="p-3 rounded-md bg-destructive/10 mb-3">
                  <p className="text-xs font-medium mb-1 text-destructive">Error:</p>
                  <p className="text-sm text-destructive">{taskDetail.error}</p>
                </div>
              )}
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Execution Log:</p>
                  {taskDetail.logs?.length === 0 && (
                    <p className="text-xs text-muted-foreground">No logs yet.</p>
                  )}
                  {taskDetail.logs?.map((log: any) => (
                    <div key={log.id} className="p-2 rounded bg-muted/30 text-xs" data-testid={`log-entry-${log.id}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium">Step {log.step}: {log.action}</span>
                        <LogStatusBadge status={log.status} />
                      </div>
                      <p className="text-muted-foreground whitespace-pre-wrap break-all">{log.detail?.substring(0, 500)}</p>
                      {log.toolUsed && <span className="text-muted-foreground">Tool: {log.toolUsed}</span>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
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
  return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
}

function LogStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    success: "default",
    failure: "destructive",
    info: "secondary",
    warning: "outline",
  };
  return <Badge variant={variants[status] || "outline"} className="text-[10px] px-1.5 py-0">{status}</Badge>;
}
