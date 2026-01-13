import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

let data = [];

let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

function normalizeHeaderKey(h) {
  return String(h ?? "")
    .replace(/\ufeff/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function dayLabel(d){
  // MMM-dd
  const m = MONTHS[d.getUTCMonth()];
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${dd}-${m}`;
}

function timeKeySort(t){
  // "413-1-11" or "413" → sort by numeric prefix if possible
  const s = normText(t);
  const first = s.split("-")[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : 0;
}

// ============================
// CSV Parse
// ============================
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

  return {
    sectorKey, projectKey,
    sector: sectorLabel,
    project: projectLabel,

    vendor: normalizeVendor(row.vendor),
    code: normText(row.code),
    request_id: normText(row.request_id),

    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
    amount_remaining: toNumber(row.amount_remaining),

    payment_request_date: normText(row.payment_request_date),
    _payReqDate: parseDateSmart(row.payment_request_date),

    time: normText(row.Time || row.time), // ✅ العمود الجديد
  };
}

// ============================
// UI Helpers
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
// Email logic
// ============================
function rowsEmailsOnly(rows){
  // email row = vendor موجود + Time موجود + تاريخ طلب صرف صالح
  return rows.filter(r => r.vendor && r.time && r._payReqDate);
}

function groupEmails(rows){
  // group by (sectorKey|projectKey|Time|dayLabel)
  const map = new Map();

  rows.forEach(r => {
    const dlab = dayLabel(r._payReqDate);
    const key = `${r.sectorKey}|||${r.projectKey}|||${r.time}|||${dlab}`;
    if (!map.has(key)){
      map.set(key, {
        key,
        sectorKey:r.sectorKey,
        projectKey:r.projectKey,
        sector:r.sector,
        project:r.project,
        time:r.time,
        day:dlab,
        date:r._payReqDate,
        total:0,
        paid:0,
        rows:[]
      });
    }
    const g = map.get(key);
    g.total += r.amount_total;
    g.paid += r.amount_paid;
    g.rows.push(r);
  });

  return Array.from(map.values());
}

function filterEmailGroups(groups){
  const sectorKey = document.getElementById("sector").value;
  const projectLabel = document.getElementById("project").value;
  const projectKey = normText(projectLabel);

  const dayInput = normText(document.getElementById("day_key").value);

  return groups.filter(g => {
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projectKey && g.projectKey !== projectKey) return false;

    if (dayInput){
      // allow partial typing like "31"
      if (!g.day.toLowerCase().includes(dayInput.toLowerCase())) return false;
    }
    return true;
  });
}

// ============================
// Render
// ============================
function render(){
  const emailRows = rowsEmailsOnly(data);
  const groupsAll = groupEmails(emailRows);

  const groups = filterEmailGroups(groupsAll);

  // KPI
  const emailsCount = groups.length;
  const totalAmount = groups.reduce((a,g)=>a+g.total,0);
  const paidAmount = groups.reduce((a,g)=>a+g.paid,0);

  document.getElementById("kpi_emails").textContent = fmtMoney(emailsCount);
  document.getElementById("kpi_total_amount").textContent = fmtMoney(totalAmount);
  document.getElementById("kpi_paid_amount").textContent = fmtMoney(paidAmount);

  // Top projects
  const byProjectCount = new Map();
  const byProjectPaid = new Map();

  groups.forEach(g=>{
    const p = g.project || "(بدون مشروع)";
    byProjectCount.set(p, (byProjectCount.get(p)||0)+1);
    byProjectPaid.set(p, (byProjectPaid.get(p)||0)+g.paid);
  });

  let topCountP="—", topCountV=0;
  byProjectCount.forEach((v,k)=>{ if(v>topCountV){topCountV=v; topCountP=k;} });

  let topPaidP="—", topPaidV=0;
  byProjectPaid.forEach((v,k)=>{ if(v>topPaidV){topPaidV=v; topPaidP=k;} });

  document.getElementById("kpi_top_count_project").textContent = topCountP;
  document.getElementById("kpi_top_count_value").textContent = fmtMoney(topCountV);

  document.getElementById("kpi_top_paid_project").textContent = topPaidP;
  document.getElementById("kpi_top_paid_value").textContent = fmtMoney(topPaidV);

  // Meta
  const sectorSelText = document.getElementById("sector").selectedOptions[0]?.textContent || "الكل";
  const projectSel = document.getElementById("project").value || "الكل";
  const daySel = normText(document.getElementById("day_key").value) || "الكل";

  document.getElementById("meta").textContent =
    `المعروض: ${emailsCount} | قطاع: ${sectorSelText} | مشروع: ${projectSel} | اليوم: ${daySel}`;

  // Build day list datalist (based on current sector/project selection, not day filter)
  const groupsNoDay = groupsAll.filter(g=>{
    const sectorKey = document.getElementById("sector").value;
    const projectKey = normText(document.getElementById("project").value);
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projectKey && g.projectKey !== projectKey) return false;
    return true;
  });

  const daySet = uniqSorted(groupsNoDay.map(g=>g.day));
  const dl = document.getElementById("day_list");
  dl.innerHTML = daySet.map(d=>`<option value="${d}"></option>`).join("");

  // Chart last 15 days (by total and paid)
  renderChart(groupsNoDay);

  // Details table (الأحدث للأقدم)
  const detailBody = document.getElementById("detail_rows");
  const sorted = [...groups].sort((a,b)=>{
    const dt = b.date.getTime() - a.date.getTime();
    if (dt !== 0) return dt;
    return timeKeySort(b.time) - timeKeySort(a.time);
  });

  detailBody.innerHTML = sorted.map(g=>`
    <tr class="clickable-row" data-key="${g.key}">
      <td>${g.day}</td>
      <td>${g.sector}</td>
      <td>${g.project}</td>
      <td class="mono">${g.time}</td>
      <td>${fmtMoney(g.total)}</td>
      <td>${fmtMoney(g.paid)}</td>
    </tr>
  `).join("");

  // Summary table (اختياري)
  const summaryBody = document.getElementById("summary_rows");
  const summaryMap = new Map(); // day|sector|project
  groups.forEach(g=>{
    const k = `${g.day}|||${g.sector}|||${g.project}`;
    if(!summaryMap.has(k)){
      summaryMap.set(k,{day:g.day, sector:g.sector, project:g.project, emails:0, total:0, paid:0});
    }
    const s = summaryMap.get(k);
    s.emails += 1;
    s.total += g.total;
    s.paid += g.paid;
  });

  const summaryArr = Array.from(summaryMap.values()).sort((a,b)=>{
    // sort by day desc (approx: month/day string) — good enough for last window
    return b.day.localeCompare(a.day);
  });

  summaryBody.innerHTML = summaryArr.map(s=>`
    <tr>
      <td>${s.day}</td>
      <td>${s.sector}</td>
      <td>${s.project}</td>
      <td>${fmtMoney(s.emails)}</td>
      <td>${fmtMoney(s.total)}</td>
      <td>${fmtMoney(s.paid)}</td>
    </tr>
  `).join("");

  // Click handler to open modal
  detailBody.querySelectorAll("tr.clickable-row").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const key = tr.getAttribute("data-key");
      const g = groupsAll.find(x=>x.key===key);
      if (g) openModal(g);
    });
  });
}

function renderChart(groupsNoDay){
  const chart = document.getElementById("chart");
  const hint = document.getElementById("chart_hint");
  const stats = document.getElementById("selected_day_stats");

  if (!groupsNoDay.length){
    chart.innerHTML = "";
    hint.textContent = "";
    stats.textContent = "";
    return;
  }

  // find max date
  const maxDate = groupsNoDay.reduce((m,g)=>Math.max(m,g.date.getTime()), 0);
  const end = new Date(maxDate);
  const start = new Date(end.getTime() - 14*24*60*60*1000);

  // aggregate by dayLabel
  const days = [];
  for(let i=0;i<15;i++){
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    d.setUTCDate(d.getUTCDate()+i);
    days.push(d);
  }

  const agg = new Map(); // dayLabel -> {total,paid}
  days.forEach(d=> agg.set(dayLabel(d), {total:0, paid:0}));

  groupsNoDay.forEach(g=>{
    const dl = g.day;
    if (agg.has(dl)){
      const a = agg.get(dl);
      a.total += g.total;
      a.paid += g.paid;
    }
  });

  const maxTotal = Math.max(...Array.from(agg.values()).map(x=>x.total), 1);

  hint.textContent = ""; // requested remove range text

  chart.innerHTML = days.map(d=>{
    const dl = dayLabel(d);
    const a = agg.get(dl);
    const hTotal = (a.total / maxTotal) * 100;
    const pct = a.total > 0 ? Math.round((a.paid / a.total) * 100) : 0;

    // paid height inside bar is pct of bar height
    const paidHeight = a.total > 0 ? pct : 0;

    return `
      <div class="chart-group">
        <div class="chart-bars">
          <div class="bar-stack" style="height:${hTotal}%; min-height:${a.total>0? '8px':'0'};">
            <div class="bar-top-value">${a.total>0 ? fmtMoney(a.total) : ""}</div>
            <div class="bar-paid" style="height:${paidHeight}%; ${a.total===0?'display:none;':''}">
              <div class="bar-percent">${a.total>0 ? (pct+"%") : ""}</div>
            </div>
          </div>
        </div>
        <div class="chart-day">${dl}</div>
      </div>
    `;
  }).join("");

  stats.textContent = ""; // هنستخدمه لاحقاً لو عملنا اختيار يوم
}

// ============================
// Modal
// ============================
function openModal(group){
  const modal = document.getElementById("emailModal");
  const closeBtn = document.getElementById("modalClose");

  const title = document.getElementById("modalTitle");
  const sub = document.getElementById("modalSub");
  const body = document.getElementById("modalRows");

  title.textContent = `${group.sector} — ${group.project}`;
  sub.textContent = `اليوم: ${group.day} | Time: ${group.time} | إجمالي: ${fmtMoney(group.total)} | المصروف: ${fmtMoney(group.paid)}`;

  const rows = [...group.rows].sort((a,b)=>b.amount_total-a.amount_total);

  body.innerHTML = rows.map((r,idx)=>`
    <tr>
      <td>${idx+1}</td>
      <td>${r.code}</td>
      <td>${r.vendor}</td>
      <td>${fmtMoney(r.amount_total)}</td>
      <td>${fmtMoney(r.amount_paid)}</td>
      <td>${fmtMoney(r.amount_remaining)}</td>
    </tr>
  `).join("");

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  const onClose = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    closeBtn.removeEventListener("click", onClose);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
  };

  const onBackdrop = (e)=>{
    if (e.target === modal) onClose();
  };

  const onEsc = (e)=>{
    if (e.key === "Escape") onClose();
  };

  closeBtn.addEventListener("click", onClose);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

// ============================
// Init
// ============================
async function init(){
  const url = DATA_SOURCE.cashCsvUrl;
  const res = await fetch(url, { cache:"no-store" });

  if(!res.ok){
    alert("مش قادر أقرأ الداتا من Google Sheets — تأكد إن الشيت Published و الرابط صحيح");
    return;
  }

  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);

  // build sector -> projects mapping
  projectsBySector = new Map();
  data.forEach(r=>{
    if (!r.projectKey) return;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  // sector dropdown
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = document.getElementById("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  // project dropdown initially all
  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // events
  document.getElementById("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    render();
  });

  ["project","day_key"].forEach(id=>{
    const el = document.getElementById(id);
    el.addEventListener("change", render);
    el.addEventListener("input", render);
  });

  document.getElementById("clearBtn").addEventListener("click", ()=>{
    document.getElementById("sector").value = "";
    rebuildProjectDropdownForSector();
    document.getElementById("day_key").value = "";
    render();
  });

  // first render
  render();
}

init();
