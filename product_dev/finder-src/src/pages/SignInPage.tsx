import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui";
import { useT } from "../i18n";

/**
 * 🔴 這一頁刻意做成 Portal 登入畫面的形狀（置中單卡、max-w-[360px]、COMART 三角標），
 *    不是行銷式的左右分割 hero —— 它是「請回 Platform 登入」的轉接頁，不是產品首頁。
 *    v2.31 之前那版還有一個 `bg-cyan-50` 配 `text-slate-100` 的卡片：配色統一之後
 *    cyan-50 變成淺底，而 slate-100 是淺色文字，**那行字直接看不見**，而且沒有
 *    session 的人一進 Finder 就會看到它。
 */
const COMART_MARK = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="302.53125 269.878906 47.6875 24.714844"
    width="44"
    height="23"
    aria-hidden="true"
  >
    <path
      fill="#ad0004"
      fillRule="nonzero"
      d="M336.148438 294.59375 L326.378906 271.554688 L316.542969 294.59375 L302.53125 294.59375 L318.625 269.878906 L334.058594 269.878906 L350.21875 294.59375 Z"
    />
    <path
      fill="#ad0004"
      fillRule="nonzero"
      d="M326.363281 283.351562 L321.265625 294.5625 L331.425781 294.5625 Z"
    />
  </svg>
);

export function SignInPage() {
  const t = useT();
  const { signIn, demoMode } = useAuth();
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");

  async function returnToPlatform() {
    setError("");
    setStatus("sending");
    try {
      await signIn("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("si_login_failed"));
      setStatus("idle");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A0E17] px-4 py-10">
      <div className="w-full max-w-[380px] rounded-[20px] border border-slate-700 bg-slate-900 px-7 py-8">
        <div className="mb-7 text-center">
          <div className="mb-2.5 inline-flex h-[52px] w-[52px] items-center justify-center">
            {COMART_MARK}
          </div>
          <div className="text-[19px] font-semibold text-slate-100">
            COMART Product Finder
          </div>
          <div className="mt-[3px] text-[11px] uppercase tracking-[0.06em] text-slate-400">
            Product Dev · Document Finder
          </div>
        </div>

        <h1 className="text-base font-semibold text-slate-100">
          {t("si_enter")}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-slate-400">
          {t("si_enter_desc")}
        </p>

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3.5">
          <p className="text-[13px] font-semibold text-slate-100">
            {t("si_sso")}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-slate-400">
            {t("si_sso_desc")}
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px] font-medium text-red-400">
            {error}
          </p>
        )}

        <Button
          className="mt-5 h-11 w-full"
          disabled={status === "sending"}
          onClick={() => void returnToPlatform()}
        >
          {status === "sending" ? t("si_returning") : t("si_return")}
        </Button>

        {demoMode && (
          <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-5 text-amber-300">
            {t("si_demo")}
          </div>
        )}

        <p className="mt-7 text-center text-[11px] text-slate-500">
          {t("si_internal")}
        </p>
      </div>
    </main>
  );
}
