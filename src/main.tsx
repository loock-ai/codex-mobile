import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  applyRuntimeEnvironment,
  type AndroidWebViewBridge,
} from "./ui/runtime-environment";
import "./styles.css";

const nativeBridge = (
  window as typeof window & { JsBridge?: AndroidWebViewBridge }
).JsBridge;

applyRuntimeEnvironment(
  document.documentElement,
  navigator.userAgent,
  nativeBridge,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
