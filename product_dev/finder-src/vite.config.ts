import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/* 🔴 demo 模式在 2.33 拿掉了（見 src/lib/config.ts 的說明）。如果還有人照舊
   文件帶 VITE_DEMO_MODE／VITE_PLATFORM_MODE，直接讓 build 失敗，而不是默默
   忽略 —— 那組旗標當年最糟的地方就是「打錯了也沒有任何提示」。*/
const RETIRED_FLAGS = ["VITE_DEMO_MODE", "VITE_PLATFORM_MODE", "VITE_SUPABASE_ANON_KEY"];

export default defineConfig(({ mode }) => {
  const stale = RETIRED_FLAGS.filter((flag) => process.env[flag] !== undefined);
  if (stale.length) {
    throw new Error(
      `這些環境變數已於 2.33 移除，請從指令中拿掉：${stale.join(", ")}。\n` +
        "Finder 現在一律連 platform，直接 `npm run build` 即可。",
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    base: mode === "production" ? "/product_dev/finder/" : "/",
    build: {
      sourcemap: mode !== "production",
      target: "es2022",
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
    },
  };
});
