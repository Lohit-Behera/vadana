import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";

import "./App.css";

import React from "react";
import ReactDOM from "react-dom/client";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system">
      <div
        id="app-layout"
        className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden"
      >
        <App />
      </div>
      <Toaster richColors closeButton />
    </ThemeProvider>
  </React.StrictMode>,
);
