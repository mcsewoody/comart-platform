import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { initLang } from "./i18n";
import "./styles.css";

/* 🔴 這裡先叫一次 initLang()：AuthProvider 裡那次是在 effect 內，跑在第一次
   繪製「之後」，所以「驗證登入狀態…」那個 splash 會固定閃一下繁中。
   這次只讀 localStorage（Portal 已存好的語言），AuthProvider 之後拿到 session
   再叫一次帶 site 的版本 —— initLang 會優先採用已存的值，不會互相打架。 */
initLang();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
