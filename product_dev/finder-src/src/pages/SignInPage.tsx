import { Boxes, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Button, Card } from "../components/ui";
import { useT } from "../i18n";

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
    <main className="grid min-h-screen bg-[#0A0E17] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_25%_20%,#2D7FF9_0,transparent_28%),linear-gradient(135deg,transparent_0%,#111827_52%,#1A2335_100%)]" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="rounded-xl bg-cyan-400 p-2.5 text-white">
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
            {t("si_h1a")}
            <br />
            {t("si_h1b")}
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            {t("si_lead")}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              [Search, t("si_f1")],
              [ShieldCheck, t("si_f2")],
              [CheckCircle2, t("si_f3")],
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
          {t("si_internal")}
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
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-100">
            {t("si_enter")}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {t("si_enter_desc")}
          </p>

          <div className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
            <CheckCircle2 className="text-cyan-800" />
            <p className="mt-3 font-bold text-slate-100">{t("si_sso")}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {t("si_sso_desc")}
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
            {status === "sending" ? t("si_returning") : t("si_return")}
          </Button>

          {demoMode && (
            <div className="mt-6 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              {t("si_demo")}
            </div>
          )}
        </Card>
      </section>
    </main>
  );
}
