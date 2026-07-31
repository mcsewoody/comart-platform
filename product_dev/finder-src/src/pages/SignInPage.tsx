import { Boxes, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Button, Card } from "../components/ui";

export function SignInPage() {
  const { signIn, demoMode } = useAuth();
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");

  async function returnToPlatform() {
    setError("");
    setStatus("sending");
    try {
      await signIn("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登入失敗");
      setStatus("idle");
    }
  }

  return (
    <main className="grid min-h-screen bg-[#f5f7f6] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_25%_20%,#18a7a7_0,transparent_28%),linear-gradient(135deg,transparent_0%,#0f172a_52%,#123237_100%)]" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="rounded-xl bg-white p-2.5 text-slate-950">
            <Boxes size={24} />
          </div>
          <div>
            <p className="text-lg font-black">COMART</p>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
              Product Finder
            </p>
          </div>
        </div>
        <div className="relative z-10 my-auto max-w-xl">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Internal product intelligence
          </p>
          <h1 className="text-5xl font-black leading-[1.08] tracking-tight">
            從散落的產品文件，
            <br />
            找到可用的答案。
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            用型號、廠商、產品類別或自然語句，快速定位既有產品與原始證據。
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              [Search, "跨語言混合搜尋"],
              [ShieldCheck, "欄位證據與審核"],
              [CheckCircle2, "原檔版本可追溯"],
            ].map(([Icon, label]) => {
              const ItemIcon = Icon as typeof Search;
              return (
                <div key={String(label)} className="border-l border-white/20 pl-4">
                  <ItemIcon className="mb-3 text-cyan-300" size={20} />
                  <p className="text-sm font-semibold text-slate-200">
                    {String(label)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        <p className="relative z-10 text-xs text-slate-500">
          僅供 COMART 核准之內部使用者
        </p>
      </section>

      <section className="flex items-center justify-center p-5 md:p-10">
        <Card className="w-full max-w-md p-7 md:p-9">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="rounded-xl bg-slate-950 p-2.5 text-white">
              <Boxes size={22} />
            </div>
            <p className="font-black">COMART Product Finder</p>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
            Secure access
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            請由 Platform 進入
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Product Finder 已改用 COMART Platform 的員工帳號與角色。請先在
            Platform 登入，再由 Product Dev 開啟本系統。
          </p>

          <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
            <CheckCircle2 className="text-cyan-800" />
            <p className="mt-3 font-bold text-slate-950">單一登入</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              不需再次輸入 Email，也不會寄送 Magic Link。
            </p>
          </div>
          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <Button
            className="mt-5 h-12 w-full"
            disabled={status === "sending"}
            onClick={() => void returnToPlatform()}
          >
            {status === "sending" ? "返回中…" : "返回 COMART Platform"}
          </Button>

          {demoMode && (
            <div className="mt-6 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              目前為 Demo Mode：未設定 Supabase 環境變數，因此會直接進入示範資料。
            </div>
          )}
        </Card>
      </section>
    </main>
  );
}
