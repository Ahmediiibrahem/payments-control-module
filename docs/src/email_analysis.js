import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

let data = [];

let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const $ = (id) => document.getElementById(id);

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

function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

// ✅ Parser للتاريخ
function parseDateSmart(s) {
  let t = normText(s);
  if (!t || t === "-" || t === "0") return null;

  t = t.split("T")[0].split(" ")[0].trim();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t);
  if (m) {
    const dd = +m[1], mm = +m[2], yy = +m[3];
    const d = new Date(Date.UTC(yy, mm - 1, dd));
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
// Pick Exacttime
// ============================
function pickExactTimeFromRaw(raw){
  for (const k of Object.keys(raw || {})) {
    const keyNorm = normalizeHeaderKey(k).toLowerCase();
    if (keyNorm === "exacttime" || keyNorm.startsWith("exacttime")) {
      const v = normText(raw[k]);
      if (v) return v;
    }
    if (keyNorm === "exact_time" || keyNorm.startsWith("exact_time")) {
      const v = normText(raw[k]);
      if (v) return v;
    }
  }
  return "";
}

// fallback (old Time)
function pickTimeFromRaw(raw){
  for (const k of Object.keys(raw || {})) {
    const keyNorm = normalizeHeaderKey(k).toLowerCase();
    if (keyNorm === "time" || keyNorm.startsWith("time")) {
      const v = normText(raw[k]);
      if (v) return v;
    }
  }
  return "";
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

  const exactTimeVal = pickExactTimeFromRaw(raw) || normText(row.exact_time);
  const oldTimeVal = pickTimeFromRaw(raw);
  const timeVal = exactTimeVal || oldTimeVal || "";

  // التاريخ: نفضّل تاريخ الطلب (الصرف)
  const payStr = normText(row.payment_request_date);
  const srcStr = normText(row.source_request_date);
  const dPay = parseDateSmart(payStr);
  const dSrc = parseDateSmart(srcStr);
  const emailDate = dPay || dSrc || null;

  const amount_total = toNumber(row.amount_total);
  const amount_paid = toNumber(row.amount_paid);
  const amount_canceled = toNumber(row.amount_canceled);

  // ✅ الفعلي = total - canceled
  const effective_total = Math.max(0, amount_total - amount_canceled);
  const effective_remaining = Math.max(0, effective_total - amount_paid);

  return {
    sectorKey, projectKey,
    sector: sectorLabel,
    project: projectLabel,
    vendor,
    code: normText(row.code),
    request_id: normText(row.request_id),

    amount_total,
    amount_paid,
    amount_canceled,

    effective_total,
    effective_remaining,

    payment_request_date: payStr,
    source_request_date: srcStr,
    _emailDate: emailDate,
    time: timeVal,
  };
}

// ============================
// Dropdown Helpers
// ============================
function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(id, values, keepValue = false) {
  const sel = $(id);
  const current = sel.value;
  const opts = uniqSorted(values);

  sel.innerHTML =
    `<option value="">الكل</option>` +
    opts.map(v => `<option value="${v}">${v}</option>`).join("");

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

// ============================
// Emails logic
// ============================
function rowsEmailsOnly(rows){
  return rows.filter(r => r.vendor && r.time && r._emailDate);
}

function groupEmails(rows){
  const map = new Map();

  rows.forEach(r => {
    const dlab = dayLabel(r._emailDate);

    // group key: sector + project + time + day
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
        date:r._emailDate,
        total:0, // effective
        paid:0,
        rows:[]
      });
    }

    const g = map.get(key);
    g.total += r.effective_total;
    g.paid  += r.amount_paid;
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

// ============================
// Day Modal (Click on chart bar) - Summary per project
// ============================
function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function ensureDayModal(){
  let modal = document.getElementById("dayModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "dayModal";
  modal.className = "modal-backdrop";
  modal.setAttribute("aria-hidden","true");

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div>
          <div id="dayModalTitle" class="modal-title">—</div>
          <div id="dayModalSub" class="modal-sub">—</div>
        </div>
        <button id="dayModalClose" class="modal-close" aria-label="Close">✕</button>
      </div>

      <div class="modal-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>المشروع</th>
                <th>الإجمالي (بعد الملغي)</th>
                <th>المصروف</th>
                <th>المتبقي</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody id="dayModalRows"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function openDayModal(dayLabelStr, groupsScope){
  const modal = ensureDayModal();
  const title = document.getElementById("dayModalTitle");
  const sub = document.getElementById("dayModalSub");
  const tbody = document.getElementById("dayModalRows");

  const items = (groupsScope || []).filter(g => g.day === dayLabelStr && g.total > 0);

  const dayTotal = items.reduce((a,x)=>a+x.total,0);
  const dayPaid  = items.reduce((a,x)=>a+x.paid,0);
  const dayRemain = Math.max(0, dayTotal - dayPaid);
  const dayPct = dayTotal > 0 ? clamp(Math.round((dayPaid/dayTotal)*100), 0, 100) : 0;

  title.textContent = `ملخص يوم: ${dayLabelStr}`;

  // ✅ السطر العلوي: totals + remaining + %
  sub.textContent = items.length
    ? `عدد الإيميلات: ${items.length} | إجمالي: ${fmtMoney(dayTotal)} | المصروف: ${fmtMoney(dayPaid)} | المتبقي: ${fmtMoney(dayRemain)} | ${dayPct}%`
    : `لا توجد إيميلات في هذا اليوم`;

  // ✅ ملخص لكل مشروع (تجميع)
  const byProject = new Map();
  items.forEach(g=>{
    const p = g.project || "(بدون مشروع)";
    if (!byProject.has(p)) byProject.set(p, { project:p, total:0, paid:0 });
    const a = byProject.get(p);
    a.total += g.total;
    a.paid  += g.paid;
  });

  const rows = Array.from(byProject.values())
    .map(x=>{
      const remain = Math.max(0, x.total - x.paid);
      const pct = x.total > 0 ? clamp(Math.round((x.paid/x.total)*100), 0, 100) : 0;
      return { ...x, remain, pct };
    })
    .sort((a,b)=> b.total - a.total);

  tbody.innerHTML = rows.map(r=>`
    <tr>
      <td>${escHtml(r.project)}</td>
      <td>${fmtMoney(r.total)}</td>
      <td>${fmtMoney(r.paid)}</td>
      <td>${fmtMoney(r.remain)}</td>
      <td>${r.pct}%</td>
    </tr>
  `).join("");

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    document.getElementById("dayModalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
  };
  const onBackdrop = (e)=>{ if(e.target===modal) close(); };
  const onEsc = (e)=>{ if(e.key==="Escape") close(); };

  document.getElementById("dayModalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

// ============================
// Chart (آخر 15 يوم فعليين)
// - ✅ الرقم فوق العمود: إجمالي اليوم (بعد الملغي) (هيظهر لأن overflow visible inline)
// ============================
function renderChart(groupsNoDay){
  const chart = $("chart");
  chart.innerHTML = "";

  const valid = (groupsNoDay || []).filter(g => g?.date instanceof Date && !isNaN(g.date.getTime()));
  if (!valid.length) return;

  // end = آخر تاريخ فيه مطالبة
  const maxMs = valid.reduce((m,g)=>Math.max(m,g.date.getTime()), 0);
  const end = new Date(maxMs);
  const start = new Date(end.getTime() - 14*24*60*60*1000);

  // 15 day list UTC
  const days = [];
  const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  for(let i=0;i<15;i++){
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate()+i);
    days.push(d);
  }

  // aggregate per day
  const agg = new Map();
  days.forEach(d => agg.set(dayLabel(d), { total: 0, paid: 0 }));
  valid.forEach(g=>{
    if (agg.has(g.day)){
      const a = agg.get(g.day);
      a.total += g.total; // effective
      a.paid  += g.paid;
    }
  });

  chart.innerHTML = days.map(d=>{
    const dl = dayLabel(d);
    const a = agg.get(dl) || { total:0, paid:0 };

    const has = a.total > 0;
    const rawPct = has ? Math.round((a.paid / a.total) * 100) : 0;
    const pct = clamp(rawPct, 0, 100);

    // ثابت للأيام اللي فيها مطالبات
    const stackHeight = has ? 100 : 0;

    // visibility small pct
    const paidExtraStyle = (has && pct > 0 && pct < 10) ? "min-height:18px;" : "";

    return `
      <div class="chart-group" data-day="${dl}">
        <div class="chart-bars" title="${has ? `Total: ${fmtMoney(a.total)} | Paid: ${fmtMoney(a.paid)} | ${pct}%` : "No emails"}">
          <div class="bar-stack" style="height:${stackHeight}%; overflow:visible;">
            <div class="bar-top-value">${has ? fmtMoney(a.total) : ""}</div>

            ${has ? `
              <div class="bar-paid" style="height:${pct}%; ${paidExtraStyle}">
                <div class="bar-percent">${pct}%</div>
              </div>
            ` : ``}
          </div>
        </div>
        <div class="chart-day">${dl}</div>
      </div>
    `;
  }).join("");

  chart.querySelectorAll(".chart-group").forEach(el=>{
    el.addEventListener("click", ()=>{
      const day = el.getAttribute("data-day");
      openDayModal(day, valid);
    });
  });
}

// ============================
// Modal (Details of a group)
// ============================
function openModal(group){
  const modal = $("emailModal");

  const remain = Math.max(0, group.total - group.paid);
  const pct = group.total > 0 ? clamp(Math.round((group.paid / group.total) * 100), 0, 100) : 0;

  $("modalTitle").textContent = `${group.sector} — ${group.project}`;
  // ✅ المتبقي قبل النسبة
  $("modalSub").textContent =
    `اليوم: ${group.day} | الوقت: ${group.time} | إجمالي (بعد الملغي): ${fmtMoney(group.total)} | المصروف: ${fmtMoney(group.paid)} | المتبقي: ${fmtMoney(remain)} | ${pct}%`;

  const rows = [...group.rows];
  $("modalRows").innerHTML = rows.map((r,idx)=>{
    const eff = r.effective_total;
    const paid = r.amount_paid;
    const rem = Math.max(0, eff - paid);
    return `
      <tr>
        <td>${idx+1}</td>
        <td>${r.code}</td>
        <td>${r.vendor}</td>
        <td>${fmtMoney(eff)}</td>
        <td>${fmtMoney(paid)}</td>
        <td>${fmtMoney(rem)}</td>
      </tr>
    `;
  }).join("");

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

// ============================
// KPI: Top project
// ============================
function setTopProjectKPIs(groups){
  const byProjectCount = new Map();
  const byProjectPaid  = new Map();

  (groups || []).forEach(g=>{
    const p = g.project || "(بدون مشروع)";
    byProjectCount.set(p, (byProjectCount.get(p) || 0) + 1);
    byProjectPaid.set(p, (byProjectPaid.get(p) || 0) + (g.paid || 0));
  });

  let topCountP = "—", topCountV = "—";
  if (byProjectCount.size){
    let bestP = null, bestV = -1;
    for (const [p,v] of byProjectCount.entries()){
      if (v > bestV){ bestV = v; bestP = p; }
    }
    topCountP = bestP ?? "—";
    topCountV = String(bestV);
  }

  let topPaidP = "—", topPaidV = "—";
  if (byProjectPaid.size){
    let bestP = null, bestV = -1;
    for (const [p,v] of byProjectPaid.entries()){
      if (v > bestV){ bestV = v; bestP = p; }
    }
    topPaidP = bestP ?? "—";
    topPaidV = fmtMoney(bestV);
  }

  $("kpi_top_count_project").textContent = topCountP;
  $("kpi_top_count_value").textContent = topCountV;

  $("kpi_top_paid_project").textContent = topPaidP;
  $("kpi_top_paid_value").textContent = topPaidV;
}

// ============================
// Render
// ============================
function render(){
  const emailRows = rowsEmailsOnly(data);
  const groupsAll = groupEmails(emailRows);

  // groups respects sector/project/day filter for table + main KPIs
  const groups = filterGroups(groupsAll);

  const totalEff = groups.reduce((a,g)=>a+g.total,0);
  const paid = groups.reduce((a,g)=>a+g.paid,0);

  $("kpi_emails").textContent = String(groups.length);
  $("kpi_total_amount").textContent = fmtMoney(totalEff);
  $("kpi_paid_amount").textContent = fmtMoney(paid);

  // ✅ أعلى مشروع (على نفس الفلتر الحالي)
  setTopProjectKPIs(groups);

  const sectorText = $("sector").selectedOptions[0]?.textContent || "الكل";
  const projectText = $("project").value || "الكل";
  const dayText = normText($("day_key").value) || "الكل";
  $("meta").textContent =
    `المعروض: ${groups.length} | قطاع: ${sectorText} | مشروع: ${projectText} | اليوم: ${dayText}`;

  // day datalist from ALL (not just filtered)
  const daySet = uniqSorted(groupsAll.map(g=>g.day));
  $("day_list").innerHTML = daySet.map(d=>`<option value="${d}"></option>`).join("");

  // chart ignores day filter but respects sector/project
  const sectorKey = $("sector").value;
  const projKey = normText($("project").value);
  const groupsNoDay = groupsAll.filter(g=>{
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projKey && g.projectKey !== projKey) return false;
    return true;
  });
  renderChart(groupsNoDay);

  // table newest→oldest
  const sorted = [...groups].sort((a,b)=> b.date.getTime() - a.date.getTime());
  $("detail_rows").innerHTML = sorted.map(g=>{
    const pct = g.total > 0 ? clamp(Math.round((g.paid / g.total) * 100), 0, 100) : 0;
    return `
      <tr class="clickable-row" data-key="${g.key}">
        <td>${g.day}</td>
        <td>${g.sector}</td>
        <td>${g.project}</td>
        <td>${g.time}</td>
        <td>${fmtMoney(g.total)}</td>
        <td>${fmtMoney(g.paid)}</td>
        <td>${pct}%</td>
      </tr>
    `;
  }).join("");

  $("detail_rows").querySelectorAll("tr").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const key = tr.getAttribute("data-key");
      const g = groupsAll.find(x=>x.key===key);
      if (g) openModal(g);
    });
  });
}

// ============================
// Init
// ============================
async function init(){
  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if(!res.ok){
    alert("مش قادر أقرأ الداتا من Google Sheets");
    return;
  }

  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);

  // sector->projects
  projectsBySector = new Map();
  data.forEach(r=>{
    if (!r.projectKey) return;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  // dropdowns
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = $("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  $("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    render();
  });
  ["project","day_key"].forEach(id=>{
    $(id).addEventListener("change", render);
    $(id).addEventListener("input", render);
  });

  $("clearBtn").addEventListener("click", ()=>{
    $("sector").value = "";
    rebuildProjectDropdownForSector();
    $("day_key").value = "";
    render();
  });

  render();
}

init();
