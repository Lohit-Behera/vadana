import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";

import "./App.css";

import React from "react";
import ReactDOM from "react-dom/client";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
      <Toaster richColors closeButton />
    </ThemeProvider>
  </React.StrictMode>,
);
