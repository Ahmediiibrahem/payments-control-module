import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

let data = [];

let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function $(id){ return document.getElementById(id); }

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

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

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
  const m = MONTHS[d.getUTCMonth()];
  const dd = String(d.getUTCDate()).padStart(2,"0");
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

  // ✅ time column can be "Time" or "time"
  const timeVal = normText(row.Time ?? row.time ?? "");

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

    time: timeVal,
  };
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

function rebuildProjectDropdownForSector() {
  const sectorKey = $("sector").value;
  const setProjects = sectorKey ? (projectsBySector.get(sectorKey) || new Set()) : null;

  const projects = sectorKey
    ? Array.from(setProjects).map(pk => projectLabelByKey.get(pk) || pk)
    : Array.from(projectLabelByKey.values());

  setSelectOptions("project", projects, true);
}

function rowsEmailsOnly(rows){
  // ✅ emails rows: vendor + valid pay date + time موجود
  const out = rows.filter(r => r.vendor && r._payReqDate && r.time);
  if (!out.length){
    console.warn("No email rows matched. Check that column 'Time' exists & filled, and payment_request_date is valid.");
  }
  return out;
}

function groupEmails(rows){
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

function filterGroups(groups){
  const sectorKey = $("sector").value;
  const projectLabel = $("project").value;
  const projectKey = normText(projectLabel);
  const dayInput = normText($("day_key").value);

  return groups.filter(g=>{
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projectKey && g.projectKey !== projectKey) return false;
    if (dayInput && !g.day.toLowerCase().includes(dayInput.toLowerCase())) return false;
    return true;
  });
}

function renderChart(groupsNoDay){
  const chart = $("chart");
  if (!groupsNoDay.length){
    chart.innerHTML = "";
    return;
  }

  const maxDate = groupsNoDay.reduce((m,g)=>Math.max(m,g.date.getTime()), 0);
  const end = new Date(maxDate);
  const start = new Date(end.getTime() - 14*24*60*60*1000);

  const days = [];
  for(let i=0;i<15;i++){
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    d.setUTCDate(d.getUTCDate()+i);
    days.push(d);
  }

  const agg = new Map();
  days.forEach(d=> agg.set(dayLabel(d), {total:0, paid:0}));

  groupsNoDay.forEach(g=>{
    if (agg.has(g.day)){
      const a = agg.get(g.day);
      a.total += g.total;
      a.paid += g.paid;
    }
  });

  const maxTotal = Math.max(...Array.from(agg.values()).map(x=>x.total), 1);

  chart.innerHTML = days.map(d=>{
    const dl = dayLabel(d);
    const a = agg.get(dl);
    const hTotal = (a.total / maxTotal) * 100;
    const pct = a.total > 0 ? Math.round((a.paid / a.total) * 100) : 0;

    return `
      <div class="chart-group">
        <div class="chart-bars">
          <div class="bar-stack" style="height:${hTotal}%;">
            <div class="bar-top-value">${a.total>0 ? fmtMoney(a.total) : ""}</div>
            <div class="bar-paid" style="height:${pct}%;">
              <div class="bar-percent">${a.total>0 ? (pct+"%") : ""}</div>
            </div>
          </div>
        </div>
        <div class="chart-day">${dl}</div>
      </div>
    `;
  }).join("");
}

function openModal(group){
  const modal = $("emailModal");
  $("modalTitle").textContent = `${group.sector} — ${group.project}`;
  $("modalSub").textContent = `اليوم: ${group.day} | Time: ${group.time} | إجمالي: ${fmtMoney(group.total)} | المصروف: ${fmtMoney(group.paid)}`;

  const rows = [...group.rows];
  $("modalRows").innerHTML = rows.map((r,idx)=>`
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

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    $("modalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
  };
  const onBackdrop = (e)=>{ if(e.target===modal) close(); };
  const onEsc = (e)=>{ if(e.key==="Escape") close(); };

  $("modalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

function render(){
  // ✅ dropdowns from ALL rows (مش emails فقط)
  // عشان الصفحة متبقاش فاضية حتى لو مفيش time
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = $("sector");
  if (sectorSel.options.length === 0){
    sectorSel.innerHTML = `<option value="">الكل</option>` + sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");
    setSelectOptions("project", Array.from(projectLabelByKey.values()));
  }

  // emails
  const emailRows = rowsEmailsOnly(data);
  const groupsAll = groupEmails(emailRows);
  const groups = filterGroups(groupsAll);

  $("kpi_emails").textContent = fmtMoney(groups.length);
  $("kpi_total_amount").textContent = fmtMoney(groups.reduce((a,g)=>a+g.total,0));
  $("kpi_paid_amount").textContent = fmtMoney(groups.reduce((a,g)=>a+g.paid,0));

  // top projects
  const byCount = new Map();
  const byPaid = new Map();
  groups.forEach(g=>{
    const p = g.project || "(بدون مشروع)";
    byCount.set(p,(byCount.get(p)||0)+1);
    byPaid.set(p,(byPaid.get(p)||0)+g.paid);
  });
  let topCountP="—", topCountV=0;
  byCount.forEach((v,k)=>{ if(v>topCountV){topCountV=v; topCountP=k;} });
  let topPaidP="—", topPaidV=0;
  byPaid.forEach((v,k)=>{ if(v>topPaidV){topPaidV=v; topPaidP=k;} });

  $("kpi_top_count_project").textContent = topCountP;
  $("kpi_top_count_value").textContent = fmtMoney(topCountV);
  $("kpi_top_paid_project").textContent = topPaidP;
  $("kpi_top_paid_value").textContent = fmtMoney(topPaidV);

  const sectorText = sectorSel.selectedOptions[0]?.textContent || "الكل";
  const projectText = $("project").value || "الكل";
  const dayText = normText($("day_key").value) || "الكل";
  $("meta").textContent = `المعروض: ${groups.length} | قطاع: ${sectorText} | مشروع: ${projectText} | اليوم: ${dayText}`;

  // day datalist
  const daySet = uniqSorted(groupsAll.map(g=>g.day));
  $("day_list").innerHTML = daySet.map(d=>`<option value="${d}"></option>`).join("");

  // chart based on current sector/project (ignoring day filter)
  const sectorKey = sectorSel.value;
  const projKey = normText($("project").value);
  const groupsNoDay = groupsAll.filter(g=>{
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projKey && g.projectKey !== projKey) return false;
    return true;
  });
  renderChart(groupsNoDay);

  // table newest → oldest
  const sorted = [...groups].sort((a,b)=> b.date.getTime() - a.date.getTime());
  $("detail_rows").innerHTML = sorted.map(g=>`
    <tr class="clickable-row" data-key="${g.key}">
      <td>${g.day}</td>
      <td>${g.sector}</td>
      <td>${g.project}</td>
      <td class="mono">${g.time}</td>
      <td>${fmtMoney(g.total)}</td>
      <td>${fmtMoney(g.paid)}</td>
    </tr>
  `).join("");

  $("detail_rows").querySelectorAll("tr").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const key = tr.getAttribute("data-key");
      const g = groupsAll.find(x=>x.key===key);
      if (g) openModal(g);
    });
  });
}

async function init(){
  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if(!res.ok){
    alert("مش قادر أقرأ الداتا من Google Sheets");
    return;
  }

  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);

  // sector -> projects map
  projectsBySector = new Map();
  data.forEach(r=>{
    if (!r.projectKey) return;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  $("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    render();
  });
  $("project").addEventListener("change", render);
  $("day_key").addEventListener("input", render);
  $("day_key").addEventListener("change", render);

  $("clearBtn").addEventListener("click", ()=>{
    $("sector").value = "";
    rebuildProjectDropdownForSector();
    $("day_key").value = "";
    render();
  });

  render();
}

init();
