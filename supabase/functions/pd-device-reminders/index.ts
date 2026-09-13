import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { namedSecretKey } from "../_shared/api-keys.ts"

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
}
function ymd(d: Date) { return d.toISOString().slice(0, 10) }
function dayDiff(a: string, b: string) { return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000) }

serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  const key = namedSecretKey("cpf_worker")
  if (!key || req.headers.get("apikey") !== key) return json({ error: "unauthorized" }, 401)
  const url = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || ""
  if (!url) return json({ error: "server_misconfigured" }, 500)
  const sb = createClient(url, key)
  const today = ymd(new Date()), year = Number(today.slice(0, 4)), monthDay = today.slice(5)
  const [{ data: admins }, { data: transfers }, { data: assets }, { data: users }] = await Promise.all([
    sb.from("users").select("emp_id,email").eq("role", "admin").eq("active", true),
    sb.from("pd_device_transfers").select("id,asset_id,from_emp_id,to_emp_id,due_on,status,asset:pd_device_assets(asset_code,brand,model)").in("status", ["accepted","awaiting_return"]).not("due_on", "is", null),
    sb.from("pd_device_assets").select("id,asset_code,brand,model,custodian_emp_id").eq("approval_status","approved").neq("status","retired"),
    sb.from("users").select("emp_id,email").eq("active",true),
  ])
  const adminIds = (admins || []).map((x:any) => x.emp_id), userMap = new Map((users || []).map((x:any) => [x.emp_id,x]))
  const reminders:any[] = []
  for (const t of transfers || []) {
    const delta = dayDiff(t.due_on, today)
    if (!(delta === 3 || delta === 0 || (delta < 0 && Math.abs(delta) % 7 === 0))) continue
    const type = delta === 3 ? "due_soon" : delta === 0 ? "due_today" : "overdue"
    const cycle = delta < 0 ? Math.abs(delta) / 7 : 0
    reminders.push({ key:`transfer:${t.id}:${type}:${cycle}`,type,assetId:t.asset_id,transferId:t.id,
      to:[...new Set([t.to_emp_id,t.from_emp_id,...adminIds].filter(Boolean))],
      title:delta<0?`設備 ${t.asset?.asset_code} 已逾期 ${Math.abs(delta)} 天`:`設備 ${t.asset?.asset_code} ${delta===0?"今天到期":"三天後到期"}`,
      body:`${t.asset?.brand || ""} ${t.asset?.model || ""}，預計歸還日 ${t.due_on}。`})
  }
  if (monthDay >= "12-01" && monthDay <= "12-31") for (const a of assets || []) {
    const { count } = await sb.from("pd_device_inventory_checks").select("id",{count:"exact",head:true}).eq("asset_id",a.id).eq("inventory_year",year)
    if (count) continue
    const day = Number(today.slice(8)); if (!(day === 1 || day === 31 || (day > 1 && (day-1)%7===0))) continue
    reminders.push({key:`inventory:${year}:${a.id}:${day}`,type:"inventory",assetId:a.id,transferId:null,
      to:[...new Set([a.custodian_emp_id,...adminIds].filter(Boolean))],title:`${year} 年設備盤點待確認：${a.asset_code}`,
      body:`請於 12 月 31 日前確認 ${a.brand} ${a.model} 是否仍在保管及目前狀況。`})
  }
  let sent=0
  for(const r of reminders){
    const {error:claimError}=await sb.from("pd_device_reminder_log").insert({reminder_key:r.key,reminder_type:r.type,asset_id:r.assetId,transfer_id:r.transferId,sent_to:r.to})
    if(claimError)continue
    await sb.from("notifications").insert(r.to.map((emp:string)=>({to_user:emp,from_user:"手機與配件",title:r.title,body:r.body,link:"/product_dev/devices/",is_read:false})))
    const resend=Deno.env.get("RESEND_API_KEY")||""
    if(resend)for(const emp of r.to){const email=userMap.get(emp)?.email;if(!email)continue;await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resend}`,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("PD_DEVICE_EMAIL_FROM")||"COMART Platform <noreply@comart.com.tw>",to:[email],subject:r.title,html:`<p>${r.body}</p><p><a href="https://platform.comart.com.tw/product_dev/devices/">開啟手機與配件</a></p>`})}).catch(()=>{})}
    sent++
  }
  return json({ok:true,date:today,candidates:reminders.length,sent})
})
