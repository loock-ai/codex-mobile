import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
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
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
