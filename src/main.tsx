import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import AppErrorBoundary from "@/components/AppErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry on auth errors (token not ready yet on refresh)
      retry: (failureCount, error) => {
        // Max 2 retries
        if (failureCount >= 2) return false;
        // Retry on 401/403 (auth not ready) or network errors
        const message = (error as Error)?.message || '';
        if (message.includes('401') || message.includes('403') || message.includes('fetch')) {
          return true;
        }
        return false;
      },
      // Standard settings for a reactive app (Smooth Refresh)
      retryDelay: (attemptIndex) => Math.min(500 * (attemptIndex + 1), 2000),
      // Set staleTime to 0 so data refetches in background immediately on mount/navigation
      staleTime: 0,
      gcTime: 30 * 60 * 1000,
      // Re-enable automatic refetching for always up-to-date data
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchInterval: false,
      throwOnError: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// if (location.hostname.includes("vercel.app")) {
//   location.href = "https://buatan.pro";
// }

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);