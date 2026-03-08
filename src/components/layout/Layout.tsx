"use client"
import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"
import { cn } from "@/lib/utils"
import { useAuthContext } from "@/contexts/AuthContext"
import { AlertTriangle } from "lucide-react"


// Idle Warning Banner Component
function IdleWarningBanner() {
  const { idleWarning, resetIdleTimer } = useAuthContext();

  if (!idleWarning) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-yellow-900 px-4 py-2 flex items-center justify-center gap-2 shadow-lg animate-pulse">
      <AlertTriangle className="h-5 w-5" />
      <span className="font-medium">
        Anda akan logout otomatis dalam 1 menit karena tidak ada aktivitas.
      </span>
      <button
        onClick={resetIdleTimer}
        className="ml-4 px-3 py-1 bg-yellow-700 text-white rounded-md hover:bg-yellow-800 transition-colors text-sm font-medium"
      >
        Tetap Login
      </button>
    </div>
  );
}

export function Layout() {
  const [isCollapsed, setIsCollapsed] = useState(true) // Default minimize



  return (
    <div className="grid min-h-screen w-full grid-cols-[auto_1fr]">
      <IdleWarningBanner />
      <div className={cn(
        "hidden border-r bg-muted/40 md:block transition-all duration-300 sticky top-0 h-screen",
        isCollapsed ? "w-[60px]" : "w-[220px] lg:w-[280px]"
      )}>
        <Sidebar isCollapsed={isCollapsed} setCollapsed={setIsCollapsed} />
      </div>
      <div className="flex flex-col min-w-0">
        <Header />
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-auto min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}