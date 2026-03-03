import { LayoutDashboard, ListTodo, KeyRound, Settings, ScrollText, Bot } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Tasks", url: "/tasks", icon: ListTodo },
  { title: "Credentials", url: "/credentials", icon: KeyRound },
  { title: "Logs", url: "/logs", icon: ScrollText },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/stats"],
    refetchInterval: 5000,
  });

  const { data: telegramStatus } = useQuery<any>({
    queryKey: ["/api/telegram/status"],
    refetchInterval: 10000,
  });

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Agent Core</h2>
            <p className="text-xs text-muted-foreground">Autonomous AI</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className="data-[active=true]:bg-sidebar-accent"
                      data-testid={`nav-${item.title.toLowerCase()}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        {item.title === "Tasks" && stats?.runningTasks > 0 && (
                          <Badge variant="default" className="ml-auto" data-testid="badge-running-tasks">
                            {stats.runningTasks}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div
            className={`h-2 w-2 rounded-full ${telegramStatus?.running ? "bg-status-online" : "bg-status-offline"}`}
            data-testid="status-telegram"
          />
          <span>Telegram {telegramStatus?.running ? "Connected" : "Disconnected"}</span>
        </div>
        {stats && (
          <div className="mt-1 text-xs text-muted-foreground" data-testid="text-total-cost">
            Total cost: ${stats.totalCost || "0.0000"}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
