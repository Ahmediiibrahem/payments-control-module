import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

let rawRows = [];

let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

const dayLabelToIso = new Map(); // "31-Jan" -> "2026-01-31"

// ============================
// Helpers
// ============================
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

function normalizeVendor(v) {
  const t = normText(v);
  if (!t) return "";
  const lower = t.toLowerCase();
  if (t === "-" || t === "0" || lower === "null" || lower === "none") return "";
  return t;
}

function parseDateSmart(s) {
  const t = normText(s);
  if (!t || t === "-" || t === "0") return null;

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // M/D/YYYY or D/M/YYYY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    let mm = a, dd = b;
    if (a > 12) { dd = a; mm = b; }
    const d = new Date(Date.UTC(y, mm - 1, dd));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function toISODate(d) {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

function toDayLabel(d){
  if(!d) return "Unknown";
  const dd = String(d.getUTCDate()).padStart(2,"0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = months[d.getUTCMonth()];
  return `${dd}-${m}`;
}

function parseCSV(text) {
  const res = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => normalizeHeaderKey(h),
  });

  if (res.errors && res.errors.length) {
    console.warn("CSV parse errors (first 10):", res.errors.slice(0, 10));
  }
  return res.data || [];
}

// ============================
// Normalize Row
// ============================
function normalizeRow(raw) {
  const row = {};
  Object.entries(raw).forEach(([key, value]) => {
    const kNorm = normalizeHeaderKey(key);
    const mapped = HEADER_MAP[kNorm] || kNorm;
    row[mapped] = value;
  });

  const sectorLabel = normText(row.sector) || "(بدون قطاع)";
  const projectLabel = normText(row.project);
  const sectorKey = normText(sectorLabel);
  const projectKey = normText(projectLabel);

  if (sectorKey) sectorLabelByKey.set(sectorKey, sectorLabel);
  if (projectKey) projectLabelByKey.set(projectKey, projectLabel);

  const vendor = normalizeVendor(row.vendor);
  const payReqDate = parseDateSmart(row.payment_request_date);

  return {
    sectorKey, projectKey,
    sector: sectorLabel,
    project: projectLabel,

    code: normText(row.code),
    vendor,

    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
    amount_remaining: toNumber(row.amount_remaining),

    payment_request_date: normText(row.payment_request_date),
    _payReqDate: payReqDate,

    time: normText(row.Time || row.time), // العمود الجديد
  };
}

// ============================
// Dropdowns
// ============================
function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(id, values, keepValue = false) {
  const sel = document.getElementById(id);
  const current = sel.value;

  const opts = uniqSorted(values);
  sel.innerHTML =
    `<option value="">الكل</option>` +
    opts.map(v => `<option value="${v}">${v}</option>`).join("");

  if (keepValue && current && opts.includes(current)) sel.value = current;
  else sel.value = "";
}

function rebuildProjectDropdownForSector() {
  const sectorKey = document.getElementById("sector").value;
  const setProjects = sectorKey ? (projectsBySector.get(sectorKey) || new Set()) : null;

  const projects = sectorKey
    ? Array.from(setProjects).map(pk => projectLabelByKey.get(pk) || pk)
    : Array.from(projectLabelByKey.values());

  setSelectOptions("project", projects, true);
}

// ============================
// Email grouping
// ============================
// Email ID = projectKey + ISO day + time
function buildEmailGroups(rows){
  const groups = new Map(); // emailId -> {dayIso, dayLabel, sector, project, ... , lines:[]}

  rows.forEach(r=>{
    // لازم Vendor + Time عشان يبقى ايميل
    if(!r.vendor) return;
    if(!r.time) return;

    const d = r._payReqDate;
    const dayIso = d ? toISODate(d) : "Unknown";
    const dayLabel = d ? toDayLabel(d) : "Unknown";

    const emailId = `${r.projectKey}__${dayIso}__${r.time}`;

    if(!groups.has(emailId)){
      groups.set(emailId,{
        emailId,
        dayIso,
        dayLabel,
        sector: r.sector,
        project: r.project,
        sectorKey: r.sectorKey,
        projectKey: r.projectKey,
        time: r.time,
        total: 0,
        paid: 0,
        lines:[]
      });
    }

    const g = groups.get(emailId);
    g.total += r.amount_total;
    g.paid += r.amount_paid;
    g.lines.push(r);
  });

  return Array.from(groups.values());
}

// ============================
// Filters
// ============================
function getFilters(){
  const sectorKey = document.getElementById("sector").value;
  const projectLabel = document.getElementById("project").value;
  const projectKey = normText(projectLabel);

  const dayInput = normText(document.getElementById("day_key").value);
  const dayIso = dayLabelToIso.get(dayInput) || ""; // لو كتب label صح

  return { sectorKey, projectKey, dayIso };
}

function filterEmailGroups(groups){
  const { sectorKey, projectKey, dayIso } = getFilters();

  return groups.filter(g=>{
    if(sectorKey && g.sectorKey !== sectorKey) return false;
    if(projectKey && g.projectKey !== projectKey) return false;
    if(dayIso && g.dayIso !== dayIso) return false;
    return true;
  });
}

// ============================
// Render: KPIs + Chart + Tables + Modal
// ============================
function render(){
  const allGroups = buildEmailGroups(rawRows);
  const groups = filterEmailGroups(allGroups);

  // KPIs
  const emailsCount = groups.length;
  const totalAmount = groups.reduce((a,g)=>a+g.total,0);
  const paidAmount = groups.reduce((a,g)=>a+g.paid,0);

  document.getElementById("kpi_emails").textContent = emailsCount.toLocaleString("en-US");
  document.getElementById("kpi_total_amount").textContent = fmtMoney(totalAmount);
  document.getElementById("kpi_paid_amount").textContent = fmtMoney(paidAmount);

  // Top projects
  const byProj = new Map(); // project -> {count,total,paid}
  groups.forEach(g=>{
    const k = g.project || "(بدون مشروع)";
    if(!byProj.has(k)) byProj.set(k,{count:0,total:0,paid:0});
    const s = byProj.get(k);
    s.count += 1;
    s.total += g.total;
    s.paid += g.paid;
  });

  let topCount = {p:"—", v:0};
  let topPaid = {p:"—", v:0};
  byProj.forEach((v,p)=>{
    if(v.count > topCount.v){ topCount={p, v:v.count}; }
    if(v.paid > topPaid.v){ topPaid={p, v:v.paid}; }
  });

  document.getElementById("kpi_top_count_project").textContent = topCount.p;
  document.getElementById("kpi_top_count_value").textContent = topCount.v.toLocaleString("en-US");
  document.getElementById("kpi_top_paid_project").textContent = topPaid.p;
  document.getElementById("kpi_top_paid_value").textContent = fmtMoney(topPaid.v);

  // Meta
  const sectorText = document.getElementById("sector").selectedOptions[0]?.textContent || "الكل";
  const projectText = document.getElementById("project").value || "الكل";
  const dayText = document.getElementById("day_key").value || "الكل";
  document.getElementById("meta").textContent =
    `المعروض: ${emailsCount} | قطاع: ${sectorText} | مشروع: ${projectText} | اليوم: ${dayText}`;

  // Chart (آخر 15 يوم من كل الداتا بعد sector/project فقط)
  // عشان التشارت يبقى له معنى حتى لو اليوم فلتر
  const { sectorKey, projectKey } = getFilters();
  const baseForChart = allGroups.filter(g=>{
    if(sectorKey && g.sectorKey !== sectorKey) return false;
    if(projectKey && g.projectKey !== projectKey) return false;
    return true;
  });

  // اجمع بالقيم حسب اليوم
  const dayAgg = new Map(); // dayIso -> {dayIso,label,total,paid}
  baseForChart.forEach(g=>{
    const k = g.dayIso || "Unknown";
    if(!dayAgg.has(k)) dayAgg.set(k,{dayIso:k,label:g.dayLabel,total:0,paid:0});
    const a = dayAgg.get(k);
    a.total += g.total;
    a.paid += g.paid;
  });

  const daysSorted = Array.from(dayAgg.values())
    .filter(x=>x.dayIso !== "Unknown")
    .sort((a,b)=>a.dayIso.localeCompare(b.dayIso));

  const last15 = daysSorted.slice(-15);

  const chart = document.getElementById("chart");
  chart.innerHTML = "";

  const maxTotal = Math.max(1, ...last15.map(d=>d.total));

  last15.forEach(d=>{
    const totalH = Math.round((d.total / maxTotal) * 100);
    const paidPct = d.total > 0 ? Math.round((d.paid / d.total) * 100) : 0;

    const wrap = document.createElement("div");
    wrap.className = "chart-group";

    const bars = document.createElement("div");
    bars.className = "chart-bars";

    const stack = document.createElement("div");
    stack.className = "bar-stack";
    stack.style.height = `${totalH}%`;

    const topVal = document.createElement("div");
    topVal.className = "bar-top-value";
    topVal.textContent = fmtMoney(d.total);

    const paidDiv = document.createElement("div");
    paidDiv.className = "bar-paid";
    paidDiv.style.height = `${paidPct}%`;

    const pct = document.createElement("div");
    pct.className = "bar-percent";
    pct.textContent = `${paidPct}%`;

    paidDiv.appendChild(pct);
    stack.appendChild(topVal);
    stack.appendChild(paidDiv);

    bars.appendChild(stack);

    const dayLbl = document.createElement("div");
    dayLbl.className = "chart-day";
    dayLbl.textContent = d.label;

    wrap.appendChild(bars);
    wrap.appendChild(dayLbl);
    chart.appendChild(wrap);
  });

  // Detail table (الأحدث للأقدم)
  const detailRows = document.getElementById("detail_rows");
  const sorted = [...groups].sort((a,b)=>{
    // day desc, time desc (محاولة رقمية)
    if(a.dayIso !== b.dayIso) return (b.dayIso || "").localeCompare(a.dayIso || "");
    const at = a.time || "", bt = b.time || "";
    return bt.localeCompare(at);
  });

  detailRows.innerHTML = sorted.map(g=>`
    <tr class="clickable-row" data-email="${g.emailId}">
      <td>${g.dayLabel}</td>
      <td>${g.sector}</td>
      <td>${g.project}</td>
      <td>${g.time}</td>
      <td>${fmtMoney(g.total)}</td>
      <td>${fmtMoney(g.paid)}</td>
    </tr>
  `).join("");

  // Summary (اختياري)
  const summaryRows = document.getElementById("summary_rows");
  if(summaryRows){
    const sumMap = new Map(); // dayIso|project -> agg
    groups.forEach(g=>{
      const k = `${g.dayIso}__${g.projectKey}`;
      if(!sumMap.has(k)){
        sumMap.set(k,{
          dayIso:g.dayIso, dayLabel:g.dayLabel,
          sector:g.sector, project:g.project,
          emails:0, total:0, paid:0
        });
      }
      const s = sumMap.get(k);
      s.emails += 1;
      s.total += g.total;
      s.paid += g.paid;
    });

    const sums = Array.from(sumMap.values()).sort((a,b)=>{
      if(a.dayIso !== b.dayIso) return (b.dayIso||"").localeCompare(a.dayIso||"");
      return (a.project||"").localeCompare(b.project||"");
    });

    summaryRows.innerHTML = sums.map(s=>`
      <tr>
        <td>${s.dayLabel}</td>
        <td>${s.sector}</td>
        <td>${s.project}</td>
        <td>${s.emails}</td>
        <td>${fmtMoney(s.total)}</td>
        <td>${fmtMoney(s.paid)}</td>
      </tr>
    `).join("");
  }

  // click row -> modal
  bindModalHandlers(sorted);
}

function bindModalHandlers(groupsSorted){
  const modal = document.getElementById("emailModal");
  const closeBtn = document.getElementById("modalClose");
  const modalTitle = document.getElementById("modalTitle");
  const modalSub = document.getElementById("modalSub");
  const modalRows = document.getElementById("modalRows");

  const map = new Map(groupsSorted.map(g=>[g.emailId,g]));

  document.querySelectorAll("#detail_rows tr[data-email]").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const id = tr.getAttribute("data-email");
      const g = map.get(id);
      if(!g) return;

      modalTitle.textContent = `${g.sector} — ${g.project}`;
      modalSub.textContent = `إجمالي قيمة الإيميل: ${fmtMoney(g.total)} | المصروف: ${fmtMoney(g.paid)} | Time: ${g.time}`;

      const lines = [...g.lines].sort((a,b)=>{
        const av = a.vendor.localeCompare(b.vendor);
        if(av !== 0) return av;
        return b.amount_total - a.amount_total;
      });

      modalRows.innerHTML = lines.map((r,i)=>`
        <tr>
          <td>${i+1}</td>
          <td>${r.code}</td>
          <td>${r.vendor}</td>
          <td>${fmtMoney(r.amount_total)}</td>
          <td>${fmtMoney(r.amount_paid)}</td>
          <td>${fmtMoney(r.amount_remaining)}</td>
        </tr>
      `).join("");

      modal.classList.add("show");
      modal.setAttribute("aria-hidden","false");
    });
  });

  const hide = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
  };

  closeBtn?.addEventListener("click", hide);
  modal?.addEventListener("click", (e)=>{
    if(e.target === modal) hide();
  });

  document.addEventListener("keydown",(e)=>{
    if(e.key === "Escape") hide();
  });
}

// ============================
// Init
// ============================
async function init(){
  const url = `${DATA_SOURCE.cashCsvUrl}&_ts=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });

  if(!res.ok){
    alert("مش قادر أقرأ الداتا من Google Sheets — تأكد إن الشيت Published");
    return;
  }

  const text = await res.text();
  if (text.trim().startsWith("<!DOCTYPE") || text.includes("<html")) {
    console.error("Received HTML instead of CSV:", text.slice(0, 200));
    alert("اللينك رجّع HTML مش CSV — تأكد إن الرابط pub?output=csv");
    return;
  }

  rawRows = parseCSV(text).map(normalizeRow);

  // Build sector->projects
  projectsBySector = new Map();
  rawRows.forEach(r=>{
    if(!r.projectKey) return;
    if(!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  // Sector dropdown
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = document.getElementById("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  // Project dropdown initially all
  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // Build day list from payment_request_date (only rows with Time)
  const days = new Map(); // iso -> label
  rawRows.forEach(r=>{
    if(!r.time) return;
    if(!r._payReqDate) return;
    const iso = toISODate(r._payReqDate);
    const label = toDayLabel(r._payReqDate);
    days.set(iso, label);
  });

  const sortedIso = Array.from(days.keys()).sort((a,b)=>a.localeCompare(b));
  const datalist = document.getElementById("day_list");
  datalist.innerHTML = "";

  dayLabelToIso.clear();
  sortedIso.forEach(iso=>{
    const label = days.get(iso);
    dayLabelToIso.set(label, iso);
    const opt = document.createElement("option");
    opt.value = label;
    datalist.appendChild(opt);
  });

  // Events
  document.getElementById("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    render();
  });

  ["project","day_key"].forEach(id=>{
    const el = document.getElementById(id);
    el.addEventListener("change", render);
    el.addEventListener("input", render);
  });

  document.getElementById("clearBtn")?.addEventListener("click", ()=>{
    document.getElementById("sector").value = "";
    rebuildProjectDropdownForSector();
    document.getElementById("day_key").value = "";
    render();
  });

  render();
}

init();
