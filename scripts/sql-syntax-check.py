"""用真的 PostgreSQL 文法（libpg_query）驗證 migration —— 包含 $$ 裡的函式本體。

這裡沒有 Docker、沒有本機 Postgres，db push 是直接打正式庫。2.35 就是「本機
驗不了 → 直接上線 → 搜尋 500」。至少先把語法錯誤擋在本機。
"""
import re, sys, pathlib
from pglast import parse_sql
from pglast.parser import ParseError

failures = []
for path in sorted(pathlib.Path("supabase/migrations").glob("*.sql")):
    sql = path.read_text()
    try:
        parse_sql(sql)
    except ParseError as e:
        failures.append(f"{path.name}: 整份 migration 語法錯誤 -> {e}")
        continue
    # $$ ... $$ 的本體是字串，上面的 parse 不會看進去，要另外驗
    for i, body in enumerate(re.findall(r"\bas \$\$(.*?)\$\$", sql, re.S | re.I)):
        stripped = body.strip()
        if not stripped:
            continue
        if re.match(r"^\s*(begin|declare)\b", stripped, re.I):
            continue  # plpgsql，libpg_query 只認 SQL 文法
        try:
            parse_sql(stripped)
        except ParseError as e:
            failures.append(f"{path.name}: 第 {i+1} 個函式本體語法錯誤 -> {e}")

if failures:
    print("\n".join(failures)); sys.exit(1)
print("所有 migration 與 SQL 函式本體語法正確")
