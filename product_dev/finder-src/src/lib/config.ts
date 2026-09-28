/* ═══════════════════════════════════════════════════════════
   🔴 這裡**沒有 demo 模式**，是 2.33 刻意拿掉的。

   原本的判定是：
     demoMode = VITE_DEMO_MODE === "true"
             || (!supabaseAnonKey && VITE_PLATFORM_MODE !== "true")

   也就是「`npm run build` 沒帶環境變數就自動變 demo 版」。demo 版會發一個
   假的管理員身分（canUpload / canSync 全開）讓人進到主畫面，但**現存每一個
   頁面用到的 API 都沒有 demo 分支**，所以它只會變成「看起來已登入、但每頁
   都丟『Platform 登入已失效』」的殼，而且 rsync 上線不會有任何提示。

   拿掉之後不留旗標：沒有旗標，就沒有「打錯指令」這個失敗模式。
   ═══════════════════════════════════════════════════════════ */

/* 🔴 用 `||` 不是 `??`：`??` 只擋 null／undefined，環境變數設成空字串會原封
   不動傳下去，platformApiUrl 就變成 `/functions/v1/…` 這種相對路徑，
   打到 GitHub Pages 自己身上而不是 Supabase。 */
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() ||
  "https://tcvlnpgpuphdalzvmoyo.supabase.co";

export const appConfig = {
  supabaseUrl,
  platformApiUrl: `${supabaseUrl}/functions/v1/pd-documents-api`,
} as const;
