import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/libre-franklin/400.css";
import "@fontsource/libre-franklin/500.css";
import "@fontsource/libre-franklin/600.css";
import "@fontsource/libre-franklin/700.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { router } from "./app/router";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { AuthProvider } from "./features/auth/AuthContext";
import { announcePwaUpdate } from "./lib/pwaUpdate";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh: () => announcePwaUpdate(() => updateServiceWorker(true))
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Rot-elementet #root saknas.");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
      <PwaUpdatePrompt />
    </QueryClientProvider>
  </StrictMode>
);
