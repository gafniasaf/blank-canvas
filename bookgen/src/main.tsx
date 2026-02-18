import { createRoot } from "react-dom/client";
import { loadRuntimeConfig } from "./lib/runtimeConfig";
import App from "./App.tsx";
import "./index.css";

// Load runtime config (public/app-config.json) before rendering.
// This is how Lovable-hosted apps get Supabase credentials.
loadRuntimeConfig().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
