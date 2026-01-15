import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

let data = [];

let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

// ============================
// Navigation context (Email modal prev/next + back)
// ============================
let __currentNavGroups = [];
let __currentNavIndexByKey = new Map();
let __currentEmailBackRender = null;

// quick lookup for any group by key (current dataset)
let __groupsByKey = new Map();

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const $ = (id) => document.getElementById(id);

// ============================
// Helpers
// ============================
function normText(x) {
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

function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function fmtMoney(n){
  const x = Number(n || 0);
  return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function isBlank(x){
  return x === null || x === undefined || String(x).trim() === "";
}

function parseCSV(text){
  const res = Papa.parse(text, { header:true, skipEmptyLines:true });
  return res.data || [];
}

function getCol(row, header){
  const idx = HEADER_MAP[header] || header;
  return row[idx];
}

function parseNumber(x){
  const v = String(x ?? "").replace(/,/g,"").trim();
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function parseDateSmart(txt){
  if (!txt) return null;
  const s = String(txt).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)){
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m){
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatIsoDate(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

function dayLabel(d){
  return formatIsoDate(d);
}

function inRangeUTC(d, fromUTC, toUTC){
  if (!d || isNaN(d.getTime())) return false;
  const ms = d.getTime();
  if (fromUTC && ms < fromUTC.getTime()) return false;
  if (toUTC && ms > toUTC.getTime()) return false;
  return true;
}

function autoSlashDateInput(input){
  const v = input.value.replace(/[^\d]/g, "");
  if (v.length <= 2){
    input.value = v;
  } else if (v.length <= 4){
    input.value = v.slice(0,2) + "/" + v.slice(2);
  } else if (v.length <= 8){
    input.value = v.slice(0,2) + "/" + v.slice(2,4) + "/" + v.slice(4);
  } else {
    input.value = v.slice(0,2) + "/" + v.slice(2,4) + "/" + v.slice(4,8);
  }
}

function uniqSorted(arr){
  return Array.from(new Set(arr)).sort((a,b)=> a.localeCompare(b));
}

function rowsEmailsOnly(rows){
  return (rows || []).filter(r => !isBlank(r.email) || !isBlank(r.exactTime) || !isBlank(r.time));
}

function normalizeRow(r){
  const sector = String(getCol(r,"Sector") ?? "").trim();
  const project = String(getCol(r,"Project") ?? "").trim();

  const out = {
    request_id: String(getCol(r,"Request_ID") ?? "").trim(),
    code: String(getCol(r,"Code") ?? "").trim(),
    vendor: String(getCol(r,"Vendor") ?? "").trim(),

    sector,
    project,

    time: String(getCol(r,"Time") ?? "").trim(),
    exactTime: String(getCol(r,"Exacttime") ?? "").trim(),
    email: String(getCol(r,"Email") ?? "").trim(),

    effective_total: parseNumber(getCol(r,"Effective_Total")),
    amount_paid: parseNumber(getCol(r,"Amount_Paid")),

    status: String(getCol(r,"Status") ?? "").trim(),
    source_request_date: String(getCol(r,"Source_Request_Date") ?? "").trim(),
    payment_request_date: String(getCol(r,"Payment_Request_Date") ?? "").trim(),
  };

  out.sectorKey = normText(out.sector);
  out.projectKey = normText(out.project);

  // parse date from email fields
  out._emailDate = null;
  // try exactTime first (assumed includes date or we use email date)
  const d1 = parseDateSmart(out.email);
  const d2 = parseDateSmart(out.exactTime);
  const d3 = parseDateSmart(out.payment_request_date);
  const d4 = parseDateSmart(out.source_request_date);

  out._emailDate = d2 || d1 || d3 || d4 || null;

  // timeMin for sorting
  out._timeMin = 0;
  const tm = String(out.time || "").match(/^(\d{1,2})[:.](\d{2})/);
  if (tm){
    const hh = +tm[1], mm = +tm[2];
    out._timeMin = hh*60 + mm;
  }

  // normalize status for filtering
  out._status = out.status;

  return out;
}

function getFilterRange(){
  const fromTxt = $("date_from_txt")?.value || "";
  const toTxt   = $("date_to_txt")?.value || "";
  const from = parseDateSmart(fromTxt);
  const to = parseDateSmart(toTxt);

  const fromUTC = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0,0,0)) : null;
  const toUTC   = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23,59,59)) : null;
  return { fromUTC, toUTC };
}

function rebuildProjectDropdownForSector(){
  const sectorKey = $("sector").value;
  if (!sectorKey){
    setSelectOptions("project", Array.from(projectLabelByKey.values()));
    return;
  }
  const set = projectsBySector.get(sectorKey) || new Set();
  const labels = Array.from(set).map(k => projectLabelByKey.get(k) || k);
  setSelectOptions("project", labels);
}

function setSelectOptions(id, labels){
  const el = $(id);
  el.innerHTML = `<option value="">الكل</option>` + (labels || []).map(x=>`<option value="${escHtml(x)}">${escHtml(x)}</option>`).join("");
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

function groupEmails(rows){
  const map = new Map();

  rows.forEach(r => {
    const dlab = dayLabel(r._emailDate);
    const key = `${r.sectorKey}|||${r.projectKey}|||${r.time}|||${dlab}`;

    if (!map.has(key)){
      map.set(key, {
        key,
        sectorKey:r.sectorKey,
        projectKey:r.projectKey,
        sector:r.sector,
        project:r.project,
        time:r.time,
        timeMin:r._timeMin,
        day:dlab,
        date:r._emailDate,
        total:0,
        paid:0,
        status:r._status,
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
  const status = $("status")?.value || "";
  const { fromUTC, toUTC } = getFilterRange();

  return groups.filter(g=>{
    if (sectorKey && g.sectorKey !== sectorKey) return false;
    if (projectKey && g.projectKey !== projectKey) return false;
    if (status && g.status !== status) return false;
    if ((fromUTC || toUTC) && !inRangeUTC(g.date, fromUTC, toUTC)) return false;
    return true;
  });
}

// ============================
// Day Modal (Click on chart bar) — multi-level drilldown
// ============================
let __dayModalHistory = [];

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
            <thead id="dayModalThead"></thead>
            <tbody id="dayModalRows"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function __setDayBackBtn(){
  const back = document.getElementById("dayModalBack");
  if (!back) return;
  back.style.display = __dayModalHistory.length ? "inline-flex" : "none";
}

function __bindDayBack(){
  const back = document.getElementById("dayModalBack");
  if (!back) return;
  back.onclick = ()=>{
    if (!__dayModalHistory.length) return;
    const prev = __dayModalHistory.pop();
    if (typeof prev === "function") prev();
    __setDayBackBtn();
  };
}

function __openDayModalShell(){
  const modal = ensureDayModal();

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    document.getElementById("dayModalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);

    // reset history
    __dayModalHistory = [];
    __setDayBackBtn();
  };

  const onBackdrop = (e)=>{ if(e.target===modal) close(); };
  const onEsc = (e)=>{ if(e.key==="Escape") close(); };

  document.getElementById("dayModalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);

  __bindDayBack();
  __setDayBackBtn();

  return modal;
}

function openDayModal(dayLabelStr, groupsScope){
  __dayModalHistory = [];
  __openDayModalShell();

  const renderDaySummary = ()=>{
    const thead = document.getElementById("dayModalThead");
    const tbody = document.getElementById("dayModalRows");
    const title = document.getElementById("dayModalTitle");
    const sub = document.getElementById("dayModalSub");

    const items = (groupsScope || []).filter(g => g.day === dayLabelStr && g.total > 0);

    const dayTotal = items.reduce((a,x)=>a+x.total,0);
    const dayPaid  = items.reduce((a,x)=>a+x.paid,0);
    const dayRemain = Math.max(0, dayTotal - dayPaid);
    const dayPct = dayTotal > 0 ? clamp(Math.round((dayPaid/dayTotal)*100), 0, 100) : 0;

    title.textContent = `ملخص يوم: ${dayLabelStr}`;
    sub.textContent = items.length
      ? `عدد الإيميلات: ${items.length} | إجمالي: ${fmtMoney(dayTotal)} | المصروف: ${fmtMoney(dayPaid)} | المتبقي: ${fmtMoney(dayRemain)} | ${dayPct}%`
      : `لا توجد إيميلات في هذا اليوم`;

    thead.innerHTML = `
      <tr>
        <th>المشروع</th>
        <th>عدد الإيميلات</th>
        <th>صافي القيمة</th>
        <th>المصروف</th>
        <th>المتبقي</th>
        <th>%</th>
      </tr>
    `;

    const byProject = new Map();
    items.forEach(g=>{
      const p = g.project || "(بدون مشروع)";
      if (!byProject.has(p)) byProject.set(p, { project:p, count:0, total:0, paid:0 });
      const a = byProject.get(p);
      a.count += 1;
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
      <tr class="clickable-row" data-project="${escHtml(r.project)}" style="cursor:pointer;">
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
      if (!project) return;
      renderProjectEmails(project);
    };

    __setDayBackBtn();
  };

  const renderProjectEmails = (project, pushHist = true)=>{
    const thead = document.getElementById("dayModalThead");
    const tbody = document.getElementById("dayModalRows");
    const title = document.getElementById("dayModalTitle");
    const sub = document.getElementById("dayModalSub");

    const items = (groupsScope || []).filter(g => g.day === dayLabelStr && (g.project || "(بدون مشروع)") === project);

    const tot = items.reduce((a,x)=>a+x.total,0);
    const paid = items.reduce((a,x)=>a+x.paid,0);
    const rem = Math.max(0, tot-paid);
    const pct = tot>0 ? clamp(Math.round((paid/tot)*100),0,100) : 0;

    // push current screen for back
    if (pushHist){
      __dayModalHistory.push(renderDaySummary);
      __setDayBackBtn();
    }

    title.textContent = `مشروع: ${project}`;
    sub.textContent = `اليوم: ${dayLabelStr} | عدد الإيميلات: ${items.length} | إجمالي: ${fmtMoney(tot)} | المصروف: ${fmtMoney(paid)} | المتبقي: ${fmtMoney(rem)} | ${pct}%`;

    thead.innerHTML = `
      <tr>
        <th>اليوم</th>
        <th>الوقت</th>
        <th>صافي القيمة</th>
        <th>المصروف</th>
        <th>المتبقي</th>
        <th>%</th>
      </tr>
    `;

    const list = items.slice().sort((a,b)=> (a.timeMin??0)-(b.timeMin??0));
    tbody.innerHTML = list.map(g=>{
      const remain = Math.max(0, g.total - g.paid);
      const pp = g.total>0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
      return `
        <tr class="clickable-row" data-gkey="${escHtml(g.key)}" style="cursor:pointer;">
          <td>${g.day}</td>
          <td>${escHtml(g.time)}</td>
          <td>${fmtMoney(g.total)}</td>
          <td>${fmtMoney(g.paid)}</td>
          <td>${fmtMoney(remain)}</td>
          <td>${pp}%</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6">لا توجد بيانات</td></tr>`;

    tbody.onclick = (e)=>{
      const tr = e.target.closest("tr[data-gkey]");
      if (!tr) return;
      const key = tr.getAttribute("data-gkey");
      const idx = list.findIndex(x=>x.key===key);
      if (idx < 0) return;

      // open email modal with project list as navigation context + back to project emails list
      openEmailModalFromList(list, idx, ()=>{
        // re-render project emails screen (بدون إضافة History جديدة)
        renderProjectEmails(project, false);
      });
    };

    __setDayBackBtn();
  };

  renderDaySummary();
}

// ============================
// ✅ Email Modal (per email/group) — رجّعناه هنا
// ============================
function __setEmailNavContext(list){
  __currentNavGroups = Array.isArray(list) ? list.slice() : [];
  __currentNavIndexByKey = new Map();
  __currentNavGroups.forEach((g,i)=> __currentNavIndexByKey.set(g.key, i));
}

let __currentEmailIdx = -1;

function openEmailModalFromList(list, idx, backRender = null){
  __setEmailNavContext(list);
  __currentEmailIdx = clamp(idx, 0, Math.max(0, __currentNavGroups.length-1));
  __currentEmailBackRender = typeof backRender === "function" ? backRender : null;

  const g = __currentNavGroups[__currentEmailIdx];
  if (g) openModal(g);
}

function openEmailModalByKey(key, backRender = null){
  const g = __groupsByKey.get(key);
  if (!g) return;
  const idx = __currentNavIndexByKey.has(key) ? __currentNavIndexByKey.get(key) : 0;
  openEmailModalFromList(__currentNavGroups.length ? __currentNavGroups : [g], idx, backRender);
}

function __renderEmailModalAt(idx){
  if (!__currentNavGroups.length) return;
  __currentEmailIdx = clamp(idx, 0, __currentNavGroups.length-1);
  const g = __currentNavGroups[__currentEmailIdx];
  if (g) openModal(g);
}

function openModal(group){
  const modal = $("emailModal");
  if (!modal) return;

  const remain = Math.max(0, group.total - group.paid);
  const pct = group.total > 0 ? clamp(Math.round((group.paid / group.total) * 100), 0, 100) : 0;

  $("modalTitle").textContent = `${group.sector} — ${group.project}`;
  $("modalSub").textContent =
    `اليوم: ${group.day} | الوقت: ${group.time} | صافي القيمة: ${fmtMoney(group.total)} | المصروف: ${fmtMoney(group.paid)} | المتبقي: ${fmtMoney(remain)} | ${pct}%`;

  const rows = [...group.rows];
  $("modalRows").innerHTML = rows.map((r,idx)=>{
    const eff = r.effective_total;
    const paid = r.amount_paid;
    const rem = Math.max(0, eff - paid);
    return `
      <tr>
        <td>${idx+1}</td>
        <td>${escHtml(r.code)}</td>
        <td>${escHtml(r.vendor)}</td>
        <td>${fmtMoney(eff)}</td>
        <td>${fmtMoney(paid)}</td>
        <td>${fmtMoney(rem)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">لا توجد بيانات</td></tr>`;

  const prevBtn = $("emailPrev");
  const nextBtn = $("emailNext");
  const backBtn = $("emailBack");

  const hasNav = (__currentNavGroups || []).length > 1;
  if (prevBtn) prevBtn.style.display = hasNav ? "inline-flex" : "none";
  if (nextBtn) nextBtn.style.display = hasNav ? "inline-flex" : "none";

  if (backBtn){
    backBtn.style.display = __currentEmailBackRender ? "inline-flex" : "none";
    backBtn.onclick = ()=>{
      if (__currentEmailBackRender) __currentEmailBackRender();
    };
  }

  if (prevBtn){
    prevBtn.onclick = ()=>{
      const newIdx = clamp(__currentEmailIdx - 1, 0, (__currentNavGroups.length||1)-1);
      __renderEmailModalAt(newIdx);
    };
  }
  if (nextBtn){
    nextBtn.onclick = ()=>{
      const newIdx = clamp(__currentEmailIdx + 1, 0, (__currentNavGroups.length||1)-1);
      __renderEmailModalAt(newIdx);
    };
  }

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    $("modalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);

    __currentEmailBackRender = null;
  };
  const onBackdrop = (e)=>{ if(e.target===modal) close(); };
  const onEsc = (e)=>{ if(e.key==="Escape") close(); };

  $("modalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
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
  days.forEach(d => agg.set(dayLabel(d), { total: 0, paid: 0 }));
  valid.forEach(g=>{
    if (agg.has(g.day)){
      const a = agg.get(g.day);
      a.total += g.total;
      a.paid  += g.paid;
    }
  });

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
  const emailRows = rowsEmailsOnly(data).filter(filterRowByControls);
  const groupsAll = groupEmails(emailRows);
  __groupsByKey = new Map(groupsAll.map(g=>[g.key,g]));
  const groups = filterGroups(groupsAll);

  const totalEff = groups.reduce((a,g)=>a+g.total,0);
  const paid = groups.reduce((a,g)=>a+g.paid,0);

  $("kpi_emails").textContent = String(groups.length);
  $("kpi_total_amount").textContent = fmtMoney(totalEff);
  $("kpi_paid_amount").textContent = fmtMoney(paid);

  setTopProjectKPIs(groups);

  // meta
  const meta = `المعروض: ${groups.length} | قطاع: ${$("sector").selectedOptions[0]?.textContent || "الكل"} | مشروع: ${$("project").value || "الكل"} | حالة: ${$("status").selectedOptions[0]?.textContent || "الكل"}`;
  $("meta").textContent = meta;

  // chart
  renderChart(groups);

  // details table
  renderDetailTable(groups, groupsAll);
}

function renderDetailTable(groups, groupsAll){
  const tbody = $("detail_rows");
  tbody.innerHTML = (groups || []).map(g=>{
    const remain = Math.max(0, g.total - g.paid);
    const pct = g.total > 0 ? clamp(Math.round((g.paid / g.total) * 100), 0, 100) : 0;

    return `
      <tr class="clickable-row" data-key="${g.key}">
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
  }).join("");

  // ✅ تفاصيل الإيميلات: فتح Modal + Prev/Next داخل نفس الفلتر
  // نجهز الـ navigation context على نفس قائمة الإيميلات المعروضة
  __setEmailNavContext(groups);

  // event delegation (أخف وأسرع)
  const tbodyEl = $("detail_rows");
  tbodyEl.onclick = (e)=>{
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.getAttribute("data-key");
    const idx = __currentNavIndexByKey.has(key) ? __currentNavIndexByKey.get(key) : groups.findIndex(x=>x.key===key);
    if (idx < 0) return;
    openEmailModalFromList(groups, idx, null);
  };
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

  projectsBySector = new Map();
  sectorLabelByKey = new Map();
  projectLabelByKey = new Map();

  data.forEach(r=>{
    if (!r.sectorKey) return;
    if (!sectorLabelByKey.has(r.sectorKey)) sectorLabelByKey.set(r.sectorKey, r.sector || r.sectorKey);
    if (!r.projectKey) return;
    if (!projectLabelByKey.has(r.projectKey)) projectLabelByKey.set(r.projectKey, r.project || r.projectKey);
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = $("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // Calendar buttons wiring
  $("date_from_btn").addEventListener("click", ()=> $("date_from_pick").showPicker ? $("date_from_pick").showPicker() : $("date_from_pick").click());
  $("date_to_btn").addEventListener("click", ()=> $("date_to_pick").showPicker ? $("date_to_pick").showPicker() : $("date_to_pick").click());

  $("date_from_pick").addEventListener("change", (e)=>{
    const v = e.target.value;
    const d = parseDateSmart(v);
    if (d) $("date_from_txt").value = formatIsoDate(d);
    render();
  });
  $("date_to_pick").addEventListener("change", (e)=>{
    const v = e.target.value;
    const d = parseDateSmart(v);
    if (d) $("date_to_txt").value = formatIsoDate(d);
    render();
  });

  // Auto slash on typing
  $("date_from_txt").addEventListener("input", (e)=>{
    autoSlashDateInput(e.target);
    render();
  });
  $("date_to_txt").addEventListener("input", (e)=>{
    autoSlashDateInput(e.target);
    render();
  });

  $("sector").addEventListener("change", ()=>{
    rebuildProjectDropdownForSector();
    render();
  });

  ["project","status"].forEach(id=>{
    $(id).addEventListener("change", render);
    $(id).addEventListener("input", render);
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
