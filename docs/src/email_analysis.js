import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function fmtMoney(n){
  const x = Number(n || 0);
  return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function toNumber(x){
  const v = String(x ?? "").replace(/,/g,"").trim();
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function normText(x){
  return String(x ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeaderKey(h){
  return String(h ?? "").trim().replace(/\s+/g, "_");
}

/**
 * ✅ parseDateSmart supports:
 * - Excel serial (e.g., 45200)
 * - YYYY-MM-DD
 * - DD/MM/YYYY or DD-MM-YYYY
 * - 8 digits: ddmmyyyy or yyyymmdd
 */
function parseDateSmart(txt){
  if (txt === null || txt === undefined) return null;
  const s0 = String(txt).trim();
  if (!s0) return null;

  // Excel serial
  if (/^\d+(\.\d+)?$/.test(s0)) {
    const num = Number(s0);
    // safe range for modern dates
    if (num > 20000 && num < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30)); // Excel epoch
      d.setUTCDate(d.getUTCDate() + Math.floor(num));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s0)){
    const d = new Date(s0);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  let m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s0);
  if (m){
    const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  // 8 digits
  const digits = s0.replace(/\D/g, "");
  if (digits.length === 8){
    const yyyy = +digits.slice(0,4);
    if (yyyy >= 2000 && yyyy <= 2100){
      const mm = +digits.slice(4,6);
      const dd = +digits.slice(6,8);
      const d = new Date(Date.UTC(yyyy, mm-1, dd));
      return isNaN(d.getTime()) ? null : d;
    } else {
      const dd = +digits.slice(0,2);
      const mm = +digits.slice(2,4);
      const yy = +digits.slice(4,8);
      const d = new Date(Date.UTC(yy, mm-1, dd));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

function dayLabel(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

function timeToMinutes(t){
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(t||""));
  if (!m) return 0;
  return (+m[1])*60 + (+m[2]);
}

function inRangeUTC(d, from, to){
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  const x = d.getTime();
  if (from && x < from.getTime()) return false;
  if (to && x > to.getTime()) return false;
  return true;
}

function parseCSV(text){
  const res = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => normalizeHeaderKey(h),
  });
  if (res.errors && res.errors.length) {
    console.warn("CSV parse errors:", res.errors.slice(0, 10));
  }
  return res.data || [];
}

// ============================
// Flexible column getters
// ============================
function pickFirst(raw, candidates){
  for (const c of candidates){
    if (raw[c] !== undefined && raw[c] !== null && String(raw[c]).trim() !== "") return raw[c];
  }
  return "";
}

function findKeyContains(raw, parts){
  const keys = Object.keys(raw || {});
  for (const k of keys){
    const kn = k.toLowerCase();
    if (parts.every(p => kn.includes(p))) return k;
  }
  return null;
}

function pickTime(raw){
  // try exacttime first
  const exactKey =
    raw.Exacttime !== undefined ? "Exacttime" :
    raw.exacttime !== undefined ? "exacttime" :
    raw.ExactTime !== undefined ? "ExactTime" :
    raw.exactTime !== undefined ? "exactTime" :
    raw.exact_time !== undefined ? "exact_time" :
    findKeyContains(raw, ["exact", "time"]);

  const timeKey =
    raw.Time !== undefined ? "Time" :
    raw.time !== undefined ? "time" :
    raw.TIME !== undefined ? "TIME" :
    raw.time_value !== undefined ? "time_value" :
    findKeyContains(raw, ["time"]);

  const v1 = exactKey ? String(raw[exactKey]).trim() : "";
  const v2 = timeKey ? String(raw[timeKey]).trim() : "";
  return v1 || v2 || "";
}

function pickSector(raw){
  const k = raw.Sector !== undefined ? "Sector" :
            raw.sector !== undefined ? "sector" :
            findKeyContains(raw, ["sector"]);
  return k ? String(raw[k]).trim() : "";
}

function pickProject(raw){
  const k = raw.Project !== undefined ? "Project" :
            raw.project !== undefined ? "project" :
            findKeyContains(raw, ["project"]);
  return k ? String(raw[k]).trim() : "";
}

function pickVendor(raw){
  const k = raw.Vendor !== undefined ? "Vendor" :
            raw.vendor !== undefined ? "vendor" :
            findKeyContains(raw, ["vendor"]);
  return k ? String(raw[k]).trim() : "";
}

function pickDates(raw){
  // try known names, then fallback by contains
  const payKey =
    raw.Payment_Request_Date !== undefined ? "Payment_Request_Date" :
    raw.payment_request_date !== undefined ? "payment_request_date" :
    findKeyContains(raw, ["payment", "request", "date"]);

  const srcKey =
    raw.Source_Request_Date !== undefined ? "Source_Request_Date" :
    raw.source_request_date !== undefined ? "source_request_date" :
    findKeyContains(raw, ["source", "request", "date"]);

  const apprKey =
    raw.Approval_Date !== undefined ? "Approval_Date" :
    raw.approval_date !== undefined ? "approval_date" :
    findKeyContains(raw, ["approval", "date"]);

  const paidKey =
    raw.Payment_Date !== undefined ? "Payment_Date" :
    raw.payment_date !== undefined ? "payment_date" :
    findKeyContains(raw, ["payment", "date"]);

  return {
    pay: payKey ? raw[payKey] : "",
    src: srcKey ? raw[srcKey] : "",
    appr: apprKey ? raw[apprKey] : "",
    paid: paidKey ? raw[paidKey] : "",
  };
}

function pickNumbers(raw){
  // try mapped headers then fallback by contains
  const totalKey =
    raw.Amount_Total !== undefined ? "Amount_Total" :
    raw.amount_total !== undefined ? "amount_total" :
    findKeyContains(raw, ["amount", "total"]);

  const paidKey =
    raw.Amount_Paid !== undefined ? "Amount_Paid" :
    raw.amount_paid !== undefined ? "amount_paid" :
    findKeyContains(raw, ["amount", "paid"]);

  const cancKey =
    raw.Amount_Canceled !== undefined ? "Amount_Canceled" :
    raw.amount_canceled !== undefined ? "amount_canceled" :
    findKeyContains(raw, ["amount", "cancel"]);

  return {
    total: totalKey ? raw[totalKey] : 0,
    paid: paidKey ? raw[paidKey] : 0,
    canceled: cancKey ? raw[cancKey] : 0,
  };
}

function statusFromDates(pay, appr, paid){
  const hasPay = !!parseDateSmart(pay);
  const hasAppr = !!parseDateSmart(appr);
  const hasPaid = !!parseDateSmart(paid);

  if (hasPay && !hasAppr && !hasPaid) return "1";
  if (hasPay && hasAppr && !hasPaid) return "2";
  if (hasPay && hasAppr && hasPaid) return "3";
  return "";
}

// ============================
// Data normalization
// ============================
let data = [];
let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

function normalizeRow(raw){
  // apply HEADER_MAP if exists (safe)
  const mapped = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = normalizeHeaderKey(k);
    const m = HEADER_MAP[kk] || kk;
    mapped[m] = v;
  }

  const sector = pickSector(mapped) || pickSector(raw) || "(بدون قطاع)";
  const project = pickProject(mapped) || pickProject(raw) || "(بدون مشروع)";
  const vendor = pickVendor(mapped) || pickVendor(raw) || "";

  const time = pickTime(mapped) || pickTime(raw);

  const dates = pickDates(mapped);
  const pay = dates.pay;
  const src = dates.src;
  const appr = dates.appr;
  const paid = dates.paid;

  const dPay = parseDateSmart(pay);
  const dSrc = parseDateSmart(src);
  const emailDate = dPay || dSrc || null;

  const nums = pickNumbers(mapped);
  const amount_total = toNumber(nums.total);
  const amount_paid = toNumber(nums.paid);
  const amount_canceled = toNumber(nums.canceled);

  const effective_total = Math.max(0, amount_total - amount_canceled);
  const effective_remaining = Math.max(0, effective_total - amount_paid);

  const sectorKey = normText(sector);
  const projectKey = normText(project);

  if (sectorKey) sectorLabelByKey.set(sectorKey, sector);
  if (projectKey) projectLabelByKey.set(projectKey, project);

  return {
    sector, project, vendor,
    sectorKey, projectKey,
    time,
    _timeMin: timeToMinutes(time),
    payment_request_date: pay,
    source_request_date: src,
    approval_date: appr,
    payment_date: paid,
    _emailDate: emailDate,
    amount_total,
    amount_paid,
    amount_canceled,
    effective_total,
    effective_remaining,
    _status: statusFromDates(pay, appr, paid),
  };
}

// ============================
// Filters
// ============================
function parseUserDateInput(txt){
  const t = String(txt ?? "").trim();
  if (!t) return null;
  return parseDateSmart(t);
}

function getFilterRange(){
  const from = parseUserDateInput($("date_from_txt")?.value);
  const to = parseUserDateInput($("date_to_txt")?.value);

  const fromUTC = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0,0,0)) : null;
  const toUTC = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23,59,59)) : null;
  return { fromUTC, toUTC };
}

function filterRowByControls(r){
  const sectorKey = $("sector").value;
  const projectLabel = $("project").value;
  const projectKey = normText(projectLabel);
  const status = $("status")?.value || "";
  const { fromUTC, toUTC } = getFilterRange();

  if (sectorKey && r.sectorKey !== sectorKey) return false;
  if (projectKey && r.projectKey !== projectKey) return false;
  if (status && r._status !== status) return false;
  if ((fromUTC || toUTC) && !inRangeUTC(r._emailDate, fromUTC, toUTC)) return false;

  return true;
}

// ✅ FIX: vendor مش شرط
function rowsEmailsOnly(rows){
  return (rows || []).filter(r => r.time && r._emailDate);
}

// ============================
// Grouping (Email Groups)
// ============================
function groupEmails(rows){
  const map = new Map();
  for (const r of rows){
    const dlab = dayLabel(r._emailDate);
    const key = `${r.sectorKey}|||${r.projectKey}|||${r.time}|||${dlab}`;

    if (!map.has(key)){
      map.set(key, {
        key,
        sectorKey: r.sectorKey,
        projectKey: r.projectKey,
        sector: r.sector,
        project: r.project,
        time: r.time,
        timeMin: r._timeMin,
        day: dlab,
        date: r._emailDate,
        status: r._status,
        total: 0,
        paid: 0,
        rows: []
      });
    }

    const g = map.get(key);
    g.total += r.effective_total;
    g.paid  += r.amount_paid;
    g.rows.push(r);
  }

  return Array.from(map.values());
}

function filterGroups(groups){
  const sectorKey = $("sector").value;
  const projectLabel = $("project").value;
  const projectKey = normText(projectLabel);
  const status = $("status")?.value || "";
  const { fromUTC, toUTC } = getFilterRange();

  return (groups || []).filter(g=>{
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projectKey && g.projectKey !== projectKey) return false;
    if (status && g.status !== status) return false;
    if ((fromUTC || toUTC) && !inRangeUTC(g.date, fromUTC, toUTC)) return false;
    return true;
  });
}

// ============================
// KPIs
// ============================
function setTopProjectKPIs(groups){
  const byCount = new Map();
  const byPaid  = new Map();

  for (const g of (groups || [])){
    const p = g.project || "(بدون مشروع)";
    byCount.set(p, (byCount.get(p) || 0) + 1);
    byPaid.set(p, (byPaid.get(p) || 0) + (g.paid || 0));
  }

  let topCountP = "—", topCountV = "—";
  if (byCount.size){
    let bestP = null, bestV = -1;
    for (const [p,v] of byCount.entries()){
      if (v > bestV){ bestV = v; bestP = p; }
    }
    topCountP = bestP ?? "—";
    topCountV = String(bestV);
  }

  let topPaidP = "—", topPaidV = "—";
  if (byPaid.size){
    let bestP = null, bestV = -1;
    for (const [p,v] of byPaid.entries()){
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
// Modal: Email details + Prev/Next + Back
// ============================
let __navList = [];
let __navIndex = -1;
let __backRender = null;

function openModalWithNav(list, idx, backRender){
  __navList = Array.isArray(list) ? list : [];
  __navIndex = clamp(idx, 0, Math.max(0, __navList.length-1));
  __backRender = typeof backRender === "function" ? backRender : null;

  const g = __navList[__navIndex];
  if (g) openEmailModal(g);
}

function openEmailModal(group){
  const modal = $("emailModal");
  if (!modal) return;

  const remain = Math.max(0, group.total - group.paid);
  const pct = group.total > 0 ? clamp(Math.round((group.paid / group.total) * 100), 0, 100) : 0;

  $("modalTitle").textContent = `${group.sector} — ${group.project}`;
  $("modalSub").textContent =
    `اليوم: ${group.day} | الوقت: ${group.time} | إجمالي: ${fmtMoney(group.total)} | المصروف: ${fmtMoney(group.paid)} | المتبقي: ${fmtMoney(remain)} | ${pct}%`;

  const rows = group.rows || [];
  $("modalRows").innerHTML = rows.map((r, i)=>{
    const eff = r.effective_total || 0;
    const paid = r.amount_paid || 0;
    const rem = Math.max(0, eff - paid);
    return `
      <tr>
        <td>${i+1}</td>
        <td>${escHtml(r.code || "—")}</td>
        <td>${escHtml(r.vendor || "—")}</td>
        <td>${fmtMoney(eff)}</td>
        <td>${fmtMoney(paid)}</td>
        <td>${fmtMoney(rem)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">لا توجد بيانات</td></tr>`;

  const prevBtn = $("emailPrev");
  const nextBtn = $("emailNext");
  const backBtn = $("emailBack");

  const hasNav = (__navList.length > 1);
  prevBtn.style.display = hasNav ? "inline-flex" : "none";
  nextBtn.style.display = hasNav ? "inline-flex" : "none";

  backBtn.style.display = __backRender ? "inline-flex" : "none";
  backBtn.onclick = ()=>{ if (__backRender) __backRender(); };

  prevBtn.onclick = ()=>{
    __navIndex = clamp(__navIndex - 1, 0, __navList.length-1);
    openEmailModal(__navList[__navIndex]);
  };
  nextBtn.onclick = ()=>{
    __navIndex = clamp(__navIndex + 1, 0, __navList.length-1);
    openEmailModal(__navList[__navIndex]);
  };

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    $("modalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
    __backRender = null;
  };
  const onBackdrop = (e)=>{ if (e.target === modal) close(); };
  const onEsc = (e)=>{ if (e.key === "Escape") close(); };

  $("modalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

// ============================
// Day Modal: Day → Projects → Emails
// ============================
let __dayHistory = [];

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
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="dayModalBack" class="nav-btn" style="display:none; opacity:.9;">↩ رجوع</button>
          <button id="dayModalClose" class="modal-close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="table-wrap">
          <table>
            <thead id="dayThead"></thead>
            <tbody id="dayTbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function dayBackVisible(){
  const b = document.getElementById("dayModalBack");
  if (!b) return;
  b.style.display = __dayHistory.length ? "inline-flex" : "none";
}

function openDayModal(dayStr, groupsScope){
  const modal = ensureDayModal();
  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  __dayHistory = [];
  dayBackVisible();

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    document.getElementById("dayModalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
    __dayHistory = [];
    dayBackVisible();
  };
  const onBackdrop = (e)=>{ if (e.target === modal) close(); };
  const onEsc = (e)=>{ if (e.key === "Escape") close(); };

  document.getElementById("dayModalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);

  const backBtn = document.getElementById("dayModalBack");
  backBtn.onclick = ()=>{
    if (!__dayHistory.length) return;
    const fn = __dayHistory.pop();
    if (typeof fn === "function") fn();
    dayBackVisible();
  };

  const renderDaySummary = ()=>{
    const title = document.getElementById("dayModalTitle");
    const sub = document.getElementById("dayModalSub");
    const thead = document.getElementById("dayThead");
    const tbody = document.getElementById("dayTbody");

    const items = (groupsScope || []).filter(g => g.day === dayStr && g.total > 0);

    const dayTotal = items.reduce((a,x)=>a+x.total,0);
    const dayPaid  = items.reduce((a,x)=>a+x.paid,0);
    const dayRemain = Math.max(0, dayTotal - dayPaid);
    const dayPct = dayTotal > 0 ? clamp(Math.round((dayPaid/dayTotal)*100), 0, 100) : 0;

    title.textContent = `ملخص يوم: ${dayStr}`;
    sub.textContent = `عدد الإيميلات: ${items.length} | إجمالي: ${fmtMoney(dayTotal)} | المصروف: ${fmtMoney(dayPaid)} | المتبقي: ${fmtMoney(dayRemain)} | ${dayPct}%`;

    thead.innerHTML = `
      <tr>
        <th>المشروع</th>
        <th>عدد الإيميلات</th>
        <th>إجمالي</th>
        <th>المصروف</th>
        <th>المتبقي</th>
        <th>%</th>
      </tr>
    `;

    const byProject = new Map();
    for (const g of items){
      const p = g.project || "(بدون مشروع)";
      if (!byProject.has(p)) byProject.set(p, { project:p, count:0, total:0, paid:0 });
      const a = byProject.get(p);
      a.count += 1;
      a.total += g.total;
      a.paid  += g.paid;
    }

    const rows = Array.from(byProject.values())
      .map(x=>{
        const remain = Math.max(0, x.total - x.paid);
        const pct = x.total > 0 ? clamp(Math.round((x.paid/x.total)*100), 0, 100) : 0;
        return { ...x, remain, pct };
      })
      .sort((a,b)=> b.total - a.total);

    tbody.innerHTML = rows.map(r=>`
      <tr data-project="${escHtml(r.project)}" style="cursor:pointer;">
        <td>${escHtml(r.project)}</td>
        <td>${r.count}</td>
        <td>${fmtMoney(r.total)}</td>
        <td>${fmtMoney(r.paid)}</td>
        <td>${fmtMoney(r.remain)}</td>
        <td>${r.pct}%</td>
      </tr>
    `).join("") || `<tr><td colspan="6">لا توجد بيانات</td></tr>`;

    tbody.onclick = (e)=>{
      const tr = e.target.closest("tr[data-project]");
      if (!tr) return;
      const project = tr.getAttribute("data-project");
      renderProjectEmails(project);
    };

    dayBackVisible();
  };

  const renderProjectEmails = (project)=>{
    const title = document.getElementById("dayModalTitle");
    const sub = document.getElementById("dayModalSub");
    const thead = document.getElementById("dayThead");
    const tbody = document.getElementById("dayTbody");

    __dayHistory.push(renderDaySummary);
    dayBackVisible();

    const list = (groupsScope || [])
      .filter(g => g.day === dayStr && (g.project || "(بدون مشروع)") === project)
      .slice()
      .sort((a,b)=> (a.timeMin ?? 0) - (b.timeMin ?? 0));

    const tot = list.reduce((a,x)=>a+x.total,0);
    const paid = list.reduce((a,x)=>a+x.paid,0);
    const rem = Math.max(0, tot-paid);
    const pct = tot>0 ? clamp(Math.round((paid/tot)*100),0,100) : 0;

    title.textContent = `مشروع: ${project}`;
    sub.textContent = `اليوم: ${dayStr} | عدد الإيميلات: ${list.length} | إجمالي: ${fmtMoney(tot)} | المصروف: ${fmtMoney(paid)} | المتبقي: ${fmtMoney(rem)} | ${pct}%`;

    thead.innerHTML = `
      <tr>
        <th>الوقت</th>
        <th>إجمالي</th>
        <th>المصروف</th>
        <th>المتبقي</th>
        <th>%</th>
      </tr>
    `;

    tbody.innerHTML = list.map((g,i)=>{
      const remain = Math.max(0, g.total - g.paid);
      const pp = g.total > 0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
      return `
        <tr data-idx="${i}" style="cursor:pointer;">
          <td>${escHtml(g.time)}</td>
          <td>${fmtMoney(g.total)}</td>
          <td>${fmtMoney(g.paid)}</td>
          <td>${fmtMoney(remain)}</td>
          <td>${pp}%</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="5">لا توجد بيانات</td></tr>`;

    tbody.onclick = (e)=>{
      const tr = e.target.closest("tr[data-idx]");
      if (!tr) return;
      const idx = +tr.getAttribute("data-idx");
      openModalWithNav(list, idx, () => renderProjectEmails(project));
    };
  };

  renderDaySummary();
}

// ============================
// Chart
// ============================
function renderChart(groupsScope){
  const chart = $("chart");
  chart.innerHTML = "";

  const valid = (groupsScope || []).filter(g => g?.date instanceof Date && !isNaN(g.date.getTime()));
  if (!valid.length) return;

  const maxMs = valid.reduce((m,g)=>Math.max(m,g.date.getTime()), 0);
  const end = new Date(maxMs);
  const start = new Date(end.getTime() - 14*24*60*60*1000);

  const days = [];
  const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  for(let i=0;i<15;i++){
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate()+i);
    days.push(d);
  }

  const agg = new Map();
  for (const d of days) agg.set(dayLabel(d), { total: 0, paid: 0 });

  for (const g of valid){
    if (agg.has(g.day)){
      const a = agg.get(g.day);
      a.total += g.total;
      a.paid  += g.paid;
    }
  }

  chart.innerHTML = days.map(d=>{
    const dl = dayLabel(d);
    const a = agg.get(dl) || { total:0, paid:0 };

    const has = a.total > 0;
    const pct = has ? clamp(Math.round((a.paid / a.total) * 100), 0, 100) : 0;

    const stackHeight = has ? 100 : 0;
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
// Details table
// ============================
function renderDetailTable(groups){
  const tbody = $("detail_rows");
  tbody.innerHTML = (groups || []).map((g,i)=>{
    const remain = Math.max(0, g.total - g.paid);
    const pct = g.total > 0 ? clamp(Math.round((g.paid / g.total) * 100), 0, 100) : 0;

    return `
      <tr data-idx="${i}" style="cursor:pointer;">
        <td>${g.day}</td>
        <td>${escHtml(g.sector)}</td>
        <td>${escHtml(g.project)}</td>
        <td>${escHtml(g.time)}</td>
        <td>${fmtMoney(g.total)}</td>
        <td>${fmtMoney(g.paid)}</td>
        <td>${fmtMoney(remain)}</td>
        <td>${pct}%</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="8">لا توجد بيانات</td></tr>`;

  tbody.onclick = (e)=>{
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) return;
    const idx = +tr.getAttribute("data-idx");
    openModalWithNav(groups, idx, null);
  };
}

// ============================
// Dropdowns
// ============================
function uniqSorted(arr){
  return Array.from(new Set(arr.filter(Boolean))).sort((a,b)=> a.localeCompare(b));
}

function setSelectOptions(id, labels){
  const el = $(id);
  const opts = uniqSorted(labels);
  el.innerHTML = `<option value="">الكل</option>` + opts.map(x=>`<option value="${escHtml(x)}">${escHtml(x)}</option>`).join("");
}

function rebuildProjectDropdownForSector(){
  const sectorKey = $("sector").value;
  if (!sectorKey){
    setSelectOptions("project", Array.from(projectLabelByKey.values()));
    return;
  }
  const set = projectsBySector.get(sectorKey) || new Set();
  const labels = Array.from(set).map(pk => projectLabelByKey.get(pk) || pk);
  setSelectOptions("project", labels);
}

// ============================
// Render
// ============================
function render(){
  const emailRows = rowsEmailsOnly(data).filter(filterRowByControls);
  const groupsAll = groupEmails(emailRows);
  const groups = filterGroups(groupsAll);

  const totalEff = groups.reduce((a,g)=>a+g.total,0);
  const paid = groups.reduce((a,g)=>a+g.paid,0);

  $("kpi_emails").textContent = String(groups.length);
  $("kpi_total_amount").textContent = fmtMoney(totalEff);
  $("kpi_paid_amount").textContent = fmtMoney(paid);

  setTopProjectKPIs(groups);

  // ✅ Debug
  const dbgTotal = data.length;
  const dbgTime = data.filter(r => r.time).length;
  const dbgDate = data.filter(r => r._emailDate).length;
  const dbgEmailRows = rowsEmailsOnly(data).length;

  $("meta").textContent =
    `المعروض: ${groups.length} | قطاع: ${$("sector").selectedOptions[0]?.textContent || "الكل"} | مشروع: ${$("project").value || "الكل"} | حالة: ${$("status").selectedOptions[0]?.textContent || "الكل"}`
    + ` || Debug: total=${dbgTotal}, time=${dbgTime}, date=${dbgDate}, emailRows=${dbgEmailRows}, groupsAll=${groupsAll.length}`;

  renderChart(groups);
  renderDetailTable(groups);
}

// ============================
// Init
// ============================
async function init(){
  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if (!res.ok){
    alert("مش قادر أقرأ الداتا من المصدر (CSV).");
    return;
  }

  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);

  // Build sector/project maps
  projectsBySector = new Map();
  for (const r of data){
    if (!r.sectorKey || !r.projectKey) continue;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  }

  // Fill dropdowns
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  $("sector").innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${escHtml(sectorLabelByKey.get(sk) || sk)}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  $("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    render();
  });

  ["project","status"].forEach(id=>{
    $(id).addEventListener("change", render);
    $(id).addEventListener("input", render);
  });

  ["date_from_txt","date_to_txt"].forEach(id=>{
    $(id).addEventListener("input", render);
    $(id).addEventListener("change", render);
  });

  $("clearBtn").addEventListener("click", ()=>{
    $("sector").value = "";
    rebuildProjectDropdownForSector();
    $("project").value = "";
    $("status").value = "";
    $("date_from_txt").value = "";
    $("date_to_txt").value = "";
    render();
  });

  render();
}

init();
