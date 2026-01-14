import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

const $ = (id) => document.getElementById(id);

let rawRows = [];
let rows = [];      // normalized
let view = [];      // filtered

let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();
let projectsBySector = new Map();

const WEEK_AR = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

function normText(x) {
  return String(x ?? "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeHeaderKey(h) {
  return String(h ?? "")
    .replace(/\ufeff/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function toNumber(x) {
  const s = normText(x);
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmtMoney(n) {
  return (n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}
function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function parseDateSmart(s) {
  let t = normText(s);
  if (!t || t === "-" || t === "0") return null;
  t = t.split("T")[0].split(" ")[0].trim();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));

  return null;
}

function parseUserDateInput(txt){
  const t = normText(txt);
  if (!t) return null;

  const m1 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m1){
    const dd = +m1[1], mm = +m1[2], yy = +m1[3];
    const d = new Date(Date.UTC(yy, mm-1, dd));
    if (isNaN(d.getTime())) return null;
    return d;
  }

  const digits = t.replace(/\D/g, "");
  if (digits.length === 8){
    const dd = +digits.slice(0,2);
    const mm = +digits.slice(2,4);
    const yy = +digits.slice(4,8);
    const d = new Date(Date.UTC(yy, mm-1, dd));
    if (isNaN(d.getTime())) return null;
    return d;
  }

  return null;
}

function autoSlashDateInput(el){
  const raw = el.value;
  const digits = raw.replace(/\D/g, "").slice(0,8);
  let out = "";
  if (digits.length <= 2) out = digits;
  else if (digits.length <= 4) out = digits.slice(0,2)+"/"+digits.slice(2);
  else out = digits.slice(0,2)+"/"+digits.slice(2,4)+"/"+digits.slice(4);
  el.value = out;
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(id, values, keepValue = false) {
  const sel = $(id);
  const current = sel.value;
  const opts = uniqSorted(values);

  sel.innerHTML = `<option value="">الكل</option>` + opts.map(v => `<option value="${v}">${v}</option>`).join("");
  if (keepValue && current && opts.includes(current)) sel.value = current;
  else sel.value = "";
}

function hasValidDate(d){ return d instanceof Date && !isNaN(d.getTime()); }

function statusFromRow({pay, appr, paid}){
  const hasPay = !!pay;
  const hasAppr = !!appr;
  const hasPaid = !!paid;
  if (hasPay && !hasAppr && !hasPaid) return "1";
  if (hasPay && hasAppr && !hasPaid) return "2";
  if (hasPay && hasAppr && hasPaid) return "3";
  return "";
}

function parseCSV(text){
  const res = Papa.parse(text, {
    header:true,
    skipEmptyLines:true,
    dynamicTyping:false,
    transformHeader:(h)=>normalizeHeaderKey(h),
  });
  return res.data || [];
}

function normalizeRow(raw){
  const row = {};
  Object.entries(raw).forEach(([k,v])=>{
    const key = normalizeHeaderKey(k);
    const mapped = HEADER_MAP[key] || key;
    row[mapped] = v;
  });

  const sector = normText(row.sector) || "(بدون قطاع)";
  const project = normText(row.project) || "(بدون مشروع)";
  const sectorKey = sector;
  const projectKey = project;

  sectorLabelByKey.set(sectorKey, sector);
  projectLabelByKey.set(projectKey, project);

  const payDate = parseDateSmart(row.payment_request_date);
  const apprDate = parseDateSmart(row.approval_date);
  const paidDate = parseDateSmart(row.payment_date);

  const amount_total = toNumber(row.amount_total);
  const amount_paid = toNumber(row.amount_paid);
  const amount_canceled = toNumber(row.amount_canceled);

  const effective_total = Math.max(0, amount_total - amount_canceled);
  const remaining = Math.max(0, effective_total - amount_paid);

  return {
    sectorKey, projectKey,
    sector, project,

    vendor: normText(row.vendor),
    exact_time: normText(row.exact_time),

    payDate, apprDate, paidDate,
    status: statusFromRow({pay:payDate, appr:apprDate, paid:paidDate}),

    amount_total,
    amount_paid,
    amount_canceled,
    effective_total,
    remaining,
  };
}

function rebuildProjectDropdownForSector(){
  const sectorKey = $("sector").value;
  const setProjects = sectorKey ? (projectsBySector.get(sectorKey) || new Set()) : null;

  const projects = sectorKey
    ? Array.from(setProjects).map(pk => projectLabelByKey.get(pk) || pk)
    : Array.from(projectLabelByKey.values());

  setSelectOptions("project", projects, true);
}

function inRangeUTC(d, from, to){
  if (!hasValidDate(d)) return false;
  const x = d.getTime();
  if (from && x < from.getTime()) return false;
  if (to && x > to.getTime()) return false;
  return true;
}

function applyFilters(){
  const sectorKey = $("sector").value;
  const projectKey = normText($("project").value);
  const status = $("status").value;

  const from = parseUserDateInput($("date_from_txt").value);
  const to = parseUserDateInput($("date_to_txt").value);
  const fromUTC = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) : null;
  const toUTC = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23,59,59)) : null;

  view = rows.filter(r=>{
    if (sectorKey && r.sectorKey !== sectorKey) return false;
    if (projectKey && r.projectKey !== projectKey) return false;
    if (status && r.status !== status) return false;

    // فلترة بالتاريخ بناء على تاريخ طلب الصرف
    if ((fromUTC || toUTC) && !inRangeUTC(r.payDate, fromUTC, toUTC)) return false;

    return true;
  });

  const meta = `المعروض: ${view.length} | قطاع: ${$("sector").selectedOptions[0]?.textContent || "الكل"} | مشروع: ${$("project").value || "الكل"} | حالة: ${$("status").selectedOptions[0]?.textContent || "الكل"}`;
  $("meta").textContent = meta;
}

function maxDateInView(){
  // “As of” = أحدث تاريخ متاح بالداتا (payment_date لو موجود، وإلا payment_request_date)
  let ms = 0;
  view.forEach(r=>{
    if (hasValidDate(r.paidDate)) ms = Math.max(ms, r.paidDate.getTime());
    if (hasValidDate(r.payDate)) ms = Math.max(ms, r.payDate.getTime());
  });
  return ms ? new Date(ms) : null;
}

function daysBetween(a,b){
  // b - a in days (UTC-ish)
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24*60*60*1000));
}

function renderExecutive(){
  const total = view.reduce((s,r)=>s+r.effective_total,0);
  const paid = view.reduce((s,r)=>s+r.amount_paid,0);
  const remain = view.reduce((s,r)=>s+r.remaining,0);

  $("k_total").textContent = fmtMoney(total);
  $("k_paid").textContent = fmtMoney(paid);
  $("k_remain").textContent = fmtMoney(remain);

  const asof = maxDateInView();
  $("asof").textContent = asof ? `As of: ${asof.toISOString().slice(0,10)}` : "As of: —";

  // SLA: paid within 5 days (only for completed payments)
  const paidRows = view.filter(r=>hasValidDate(r.payDate) && hasValidDate(r.paidDate));
  let slaOk = 0;
  paidRows.forEach(r=>{
    const d = daysBetween(r.payDate, r.paidDate);
    if (d <= 5 && d >= 0) slaOk++;
  });
  const slaPct = paidRows.length ? Math.round((slaOk/paidRows.length)*100) : 0;
  $("k_sla").textContent = paidRows.length ? `${slaPct}% (${slaOk}/${paidRows.length})` : "—";
}

function renderExposure(){
  const exp = { "1":0, "2":0, "3":0, "all":0 };
  view.forEach(r=>{
    if (r.remaining <= 0) return;
    if (r.status === "1") exp["1"] += r.remaining;
    else if (r.status === "2") exp["2"] += r.remaining;
    else if (r.status === "3") exp["3"] += r.remaining;
    exp.all += r.remaining;
  });

  $("exp_1").textContent = fmtMoney(exp["1"]);
  $("exp_2").textContent = fmtMoney(exp["2"]);
  $("exp_3").textContent = fmtMoney(exp["3"]);
  $("exp_all").textContent = fmtMoney(exp.all);
}

function renderAging(){
  const asof = maxDateInView();
  const agingBase = asof || new Date();

  const buckets = [
    { name:"0–3",  min:0,  max:3,  count:0, sum:0 },
    { name:"4–7",  min:4,  max:7,  count:0, sum:0 },
    { name:"8–14", min:8,  max:14, count:0, sum:0 },
    { name:"+15",  min:15, max:99999, count:0, sum:0 },
  ];

  const pending = view.filter(r=>hasValidDate(r.payDate) && r.remaining > 0);

  pending.forEach(r=>{
    const age = daysBetween(r.payDate, agingBase);
    const b = buckets.find(x=> age >= x.min && age <= x.max) || buckets[buckets.length-1];
    b.count += 1;
    b.sum += r.remaining;
  });

  const maxSum = Math.max(1, ...buckets.map(b=>b.sum));
  const bars = buckets.map(b=>{
    const w = Math.round((b.sum/maxSum)*100);
    return `
      <div style="margin:10px 0;">
        <div class="small" style="display:flex;justify-content:space-between;">
          <b>${b.name} يوم</b>
          <span>متبقي: ${fmtMoney(b.sum)} | عدد: ${b.count}</span>
        </div>
        <div style="height:12px;border:1px solid var(--border);border-radius:999px;overflow:hidden;margin-top:6px;background:rgba(255,255,255,.04);">
          <div style="height:100%;width:${w}%;background:rgba(255,255,255,.18);"></div>
        </div>
      </div>
    `;
  }).join("");
  $("agingBars").innerHTML = bars;

  $("agingTable").innerHTML = buckets.map(b=>`
    <tr>
      <td>${b.name} يوم</td>
      <td>${b.count}</td>
      <td>${fmtMoney(b.sum)}</td>
    </tr>
  `).join("");
}

function renderBottlenecks(){
  const asof = maxDateInView() || new Date();

  const map = new Map(); // project -> {count,sumRemain,sumAge}
  view.forEach(r=>{
    if (!hasValidDate(r.payDate)) return;
    if (r.remaining <= 0) return;

    const p = r.project || "(بدون مشروع)";
    if (!map.has(p)) map.set(p, { project:p, count:0, remain:0, sumAge:0 });
    const a = map.get(p);
    a.count += 1;
    a.remain += r.remaining;
    a.sumAge += Math.max(0, daysBetween(r.payDate, asof));
  });

  const arr = Array.from(map.values())
    .map(x=>({ ...x, avgAge: x.count ? Math.round(x.sumAge/x.count) : 0 }))
    .sort((a,b)=> b.remain - a.remain)
    .slice(0,10);

  $("bottTable").innerHTML = arr.map(x=>`
    <tr>
      <td>${escHtml(x.project)}</td>
      <td>${x.count}</td>
      <td>${fmtMoney(x.remain)}</td>
      <td>${x.avgAge}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">لا توجد طلبات غير مكتملة في الفلاتر الحالية</td></tr>`;
}

function renderWeekPatternAndForecast(){
  // نعتمد على payment_date فقط (عمليات دفع حقيقية)
  const paid = view.filter(r=>hasValidDate(r.paidDate) && r.amount_paid > 0);

  const lastPaidMs = paid.reduce((m,r)=>Math.max(m,r.paidDate.getTime()), 0);
  if (!lastPaidMs){
    $("weekTable").innerHTML = `<tr><td colspan="3">لا توجد عمليات دفع في الفلاتر الحالية</td></tr>`;
    $("fc_avg").textContent = "—";
    $("fc_7").textContent = "—";
    $("fc_14").textContent = "—";
    return;
  }

  const end = new Date(lastPaidMs);
  const start = new Date(end.getTime() - 29*24*60*60*1000);

  const paid30 = paid.filter(r=> r.paidDate.getTime() >= start.getTime() && r.paidDate.getTime() <= end.getTime());

  // Week pattern
  const wk = Array.from({length:7}, (_,i)=>({ i, sum:0, count:0 }));
  paid30.forEach(r=>{
    const day = r.paidDate.getUTCDay(); // 0=Sun
    wk[day].sum += r.amount_paid;
    wk[day].count += 1;
  });

  $("weekTable").innerHTML = wk.map(x=>`
    <tr>
      <td>${WEEK_AR[x.i]}</td>
      <td>${fmtMoney(x.sum)}</td>
      <td>${x.count}</td>
    </tr>
  `).join("");

  // Forecast
  const totalPaid30 = paid30.reduce((s,r)=>s+r.amount_paid,0);
  const avg = totalPaid30 / 30;

  $("fc_avg").textContent = fmtMoney(avg);
  $("fc_7").textContent = fmtMoney(avg * 7);
  $("fc_14").textContent = fmtMoney(avg * 14);
}

function renderDataQuality(){
  const total = view.length || 1;

  const metrics = [
    { key:"missing_payDate", label:"طلبات بدون تاريخ طلب صرف", test:(r)=>!hasValidDate(r.payDate) },
    { key:"missing_vendor", label:"صفوف بدون مورد", test:(r)=>!normText(r.vendor) },
    { key:"missing_status", label:"صفوف حالة غير محددة (تواريخ ناقصة)", test:(r)=>!r.status },
    { key:"missing_project", label:"صفوف بدون مشروع", test:(r)=>!normText(r.project) || r.project==="(بدون مشروع)" },
  ];

  const rowsOut = metrics.map(m=>{
    const cnt = view.filter(m.test).length;
    const pct = Math.round((cnt/total)*100);
    return { ...m, cnt, pct };
  });

  $("dqTable").innerHTML = rowsOut.map(x=>`
    <tr>
      <td>${x.label}</td>
      <td>${x.pct}%</td>
      <td>${x.cnt}</td>
    </tr>
  `).join("");
}

function renderAll(){
  applyFilters();
  renderExecutive();
  renderExposure();
  renderAging();
  renderBottlenecks();
  renderWeekPatternAndForecast();
  renderDataQuality();
}

async function init(){
  if (typeof Papa === "undefined"){
    $("meta").textContent = "⚠️ Papaparse غير محمّل. تأكد من ./assets/vendor/papaparse.min.js";
    return;
  }

  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if (!res.ok){
    $("meta").textContent = `⚠️ فشل تحميل الداتا. HTTP ${res.status}`;
    return;
  }

  const text = await res.text();
  rawRows = parseCSV(text);
  rows = rawRows.map(normalizeRow);

  // build maps
  projectsBySector = new Map();
  rows.forEach(r=>{
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  // build dropdowns
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  $("sector").innerHTML = `<option value="">الكل</option>` +
    sectorKeys.map(sk=>`<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // listeners
  $("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    renderAll();
  });
  ["project","status"].forEach(id=>{
    $(id).addEventListener("change", renderAll);
    $(id).addEventListener("input", renderAll);
  });

  ["date_from_txt","date_to_txt"].forEach(id=>{
    const el = $(id);
    el.addEventListener("input", ()=>{
      autoSlashDateInput(el);
      renderAll();
    });
  });

  $("clearBtn").addEventListener("click", ()=>{
    $("sector").value = "";
    setSelectOptions("project", Array.from(projectLabelByKey.values()));
    $("status").value = "";
    $("date_from_txt").value = "";
    $("date_to_txt").value = "";
    renderAll();
  });

  renderAll();
}

init();

