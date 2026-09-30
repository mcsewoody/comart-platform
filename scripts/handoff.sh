#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  兩台 Mac 交替工作的交接機制
#
#  Woody 在兩台 Mac 上輪流工作，兩台都開著 iCloud「桌面與文件」同步。
#  所以 ~/Documents/comart-platform **本身就在 iCloud 裡** —— repo 與未 commit
#  的檔案會自己同步。真正斷掉的是這三件：
#
#    ① Claude 的記憶（~/.claude 不在 iCloud）
#    ② 「上次做到哪裡」的脈絡
#    ③ iCloud 還沒上傳完就關機 → 另一台看到的是舊檔
#
#  用法：
#    ./scripts/handoff.sh park     離開這台之前跑
#    ./scripts/handoff.sh resume   到另一台開工時跑
#    ./scripts/handoff.sh status   看目前狀態（不改任何東西）
# ══════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
MEM_STORE="$ICLOUD/_claude-memory"
HANDOFF="$REPO/HANDOFF.md"
HOST="$(scutil --get ComputerName 2>/dev/null || hostname -s)"

# 🔴 變數後面若緊接全形字元（（、：、…），一定要寫成 ${var} ——
#    bash 會把多位元組字元併進變數名，報 `key?: unbound variable`。
c_ok()   { printf '\033[32m✅ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m⚠️  %s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m🔴 %s\033[0m\n' "$*"; }
c_head() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

# ── 記憶：搬進 iCloud 並用 symlink 接回來 ──────────────────────
# 🔴 記憶目錄是**用路徑當 key** 的（~/.claude/projects/<key>/memory），
#    所以同一個專案從不同目錄啟動就是不同的記憶。這裡把每個 key 的 memory
#    搬進 iCloud 再 symlink 回去，兩台就共用同一份。
#    ⚠️ 只搬 memory/，不搬對話紀錄（331 MB，而且不需要跨機器）。
link_memory() {
  mkdir -p "$MEM_STORE"
  local moved=0 linked=0
  for proj in "$HOME/.claude/projects"/*; do
    [ -d "$proj" ] || continue
    local key; key="$(basename "$proj")"
    local mem="$proj/memory"
    local dest="$MEM_STORE/$key"

    if [ -L "$mem" ]; then linked=$((linked+1)); continue; fi
    [ -d "$mem" ] || continue
    # 目錄是空的就不必搬，直接連過去
    if [ -z "$(ls -A "$mem" 2>/dev/null)" ]; then
      mkdir -p "$dest"; rmdir "$mem" && ln -s "$dest" "$mem" && linked=$((linked+1))
      continue
    fi
    mkdir -p "$dest"
    # 🔴 用 rsync 合併而不是覆蓋：另一台可能已經寫過同名檔案。
    #    --update 只在來源比較新時才覆蓋，不會把對方的較新版本蓋掉。
    rsync -a --update "$mem"/ "$dest"/ || { c_err "搬移 $key 的記憶失敗，跳過"; continue; }
    local bak="$mem.local-backup-$(date +%Y%m%d%H%M%S)"
    mv "$mem" "$bak" && ln -s "$dest" "$mem" && { moved=$((moved+1)); echo "   ${key}（原目錄留在 $(basename "$bak")）"; }
  done
  c_ok "記憶已共用：新搬 $moved 個、原本就連好 $linked 個 → $MEM_STORE"
}

# ── iCloud 是否還在上傳／下載 ──────────────────────────────────
icloud_pending() {
  find "$REPO" -name "*.icloud" -not -path "*/node_modules/*" 2>/dev/null | head -20
}

cmd_status() {
  c_head "機器"
  echo "   $HOST"
  c_head "git"
  git -C "$REPO" status -sb | head -1
  local dirty; dirty=$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')
  [ "$dirty" = "0" ] && c_ok "工作區乾淨" || c_warn "有 $dirty 個未提交的變更"
  c_head "記憶"
  local n=0
  for p in "$HOME/.claude/projects"/*/memory; do [ -L "$p" ] && n=$((n+1)); done
  [ "$n" -gt 0 ] && c_ok "$n 個專案的記憶已放在 iCloud（共用）" || c_warn "記憶還沒共用，請先跑 ./scripts/handoff.sh park"
  c_head "iCloud 同步"
  local pend; pend=$(icloud_pending | wc -l | tr -d ' ')
  [ "$pend" = "0" ] && c_ok "沒有未下載的檔案" || { c_err "有 $pend 個檔案還沒從 iCloud 下載完"; icloud_pending | head -5; }
  if [ -f "$HANDOFF" ]; then c_head "上次的交接筆記"; head -20 "$HANDOFF"; fi
}

cmd_park() {
  c_head "1／4  記憶搬到 iCloud"
  link_memory

  c_head "2／4  未提交的工作"
  local dirty; dirty=$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')
  if [ "$dirty" != "0" ]; then
    c_warn "有 $dirty 個未提交的變更"
    git -C "$REPO" status --short | head -20
    echo
    # 🔴 不自動 commit：未完成的程式碼被 commit 進 main 比沒 commit 更糟。
    #    repo 在 iCloud 裡，未 commit 的檔案本來就會同步過去 —— 這裡只是提醒。
    echo "   這些檔案會**經由 iCloud** 同步到另一台（repo 就在 iCloud 裡），"
    echo "   不必為了換機器而 commit。要保險的話自己跑："
    echo "     git switch -c wip/$(date +%m%d) && git add -A && git commit -m 'WIP' && git push -u origin HEAD"
  else
    c_ok "工作區乾淨"
  fi

  c_head "3／4  寫交接筆記"
  {
    echo "# 交接筆記"
    echo
    echo "> 這個檔案**不進版控**（repo 是 public），靠 iCloud 同步。"
    echo "> 每次 \`handoff.sh park\` 會重寫這一段以上的內容，底下「手寫備註」保留。"
    echo
    echo "- **離開的機器**：$HOST"
    echo "- **時間**：$(date '+%Y-%m-%d %H:%M')"
    echo "- **分支／HEAD**：$(git -C "$REPO" rev-parse --abbrev-ref HEAD) @ $(git -C "$REPO" log --oneline -1)"
    echo "- **未提交變更**：$dirty 個"
    [ "$dirty" != "0" ] && git -C "$REPO" status --short | sed 's/^/      /'
    echo
    echo "## 最近 5 個 commit"
    git -C "$REPO" log --oneline -5 | sed 's/^/- /'
    echo
    echo "## 手寫備註"
    echo
    if [ -f "$HANDOFF" ] && grep -q '^## 手寫備註' "$HANDOFF"; then
      sed -n '/^## 手寫備註/,$p' "$HANDOFF" | tail -n +2
    else
      echo "（在這裡寫「下次要接著做什麼」，park 不會蓋掉這一段）"
    fi
  } > "$HANDOFF.tmp" && mv "$HANDOFF.tmp" "$HANDOFF"
  c_ok "已寫入 HANDOFF.md"

  c_head "4／4  等 iCloud 上傳完"
  # 🔴 這一步最容易被跳過，而它正是「另一台看到舊檔」的成因。
  #    brctl 是 macOS 內建的 iCloud 控制工具。
  if command -v brctl >/dev/null 2>&1; then
    echo "   正在等待（最多 60 秒）…"
    ( brctl log --wait --shorten >/dev/null 2>&1 & sleep 60; kill %1 2>/dev/null ) 2>/dev/null
    c_ok "iCloud 應該上傳完了"
  fi
  echo
  c_warn "關機前請確認選單列的 iCloud 圖示沒有在轉圈。"
}

cmd_resume() {
  c_head "1／3  把 iCloud 的檔案抓下來"
  if command -v brctl >/dev/null 2>&1; then
    brctl download "$REPO" 2>/dev/null
    brctl download "$MEM_STORE" 2>/dev/null
  fi
  local pend; pend=$(icloud_pending | wc -l | tr -d ' ')
  [ "$pend" = "0" ] && c_ok "全部已在本機" || c_err "還有 $pend 個檔案沒下載完，等一下再跑一次"

  c_head "2／3  接上共用記憶"
  link_memory

  c_head "3／3  git"
  git -C "$REPO" fetch --all --prune 2>/dev/null
  git -C "$REPO" status -sb | head -1
  local behind; behind=$(git -C "$REPO" rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
  [ "$behind" != "0" ] && c_warn "落後遠端 $behind 個 commit，需要 git pull" || c_ok "與遠端同步"

  if [ -f "$HANDOFF" ]; then c_head "上次的交接筆記"; cat "$HANDOFF"; fi
}

case "${1:-status}" in
  park)   cmd_park ;;
  resume) cmd_resume ;;
  status) cmd_status ;;
  *) echo "用法：$0 {park|resume|status}"; exit 1 ;;
esac
