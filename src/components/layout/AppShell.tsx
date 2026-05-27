import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

type Props = {
  sidebar: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, children }: Props) {
  return (
    <SidebarProvider className="flex h-dvh max-h-dvh min-h-0 w-full max-w-full overflow-hidden">
      {sidebar}
      <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="glass-surface glass-hairline-b flex h-14 shrink-0 items-center px-3 md:hidden">
          <SidebarTrigger />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
