import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyRuntimeEnvironment } from "./ui/runtime-environment";
import "./styles.css";

applyRuntimeEnvironment(document.documentElement, navigator.userAgent);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
