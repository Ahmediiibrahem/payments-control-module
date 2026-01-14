import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

const $ = (id) => document.getElementById(id);

let rawRows = [];
let rows = [];   // normalized
let view = [];   // filtered

let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();
let projectsBySector = new Map();

const WEEK_AR = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

// ===================== Helpers
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
function hasValidDate(d){ return d instanceof Date && !isNaN(d.getTime()); }
function daysBetween(a,b){
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24*60*60*1000));
}

function parseUserDateInput(txt){
  const t = normText(txt);
  if (!t) return null;

  const m1 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m1){
    const dd = +m1[1], mm = +m1[2], yy = +m1[3];
    const d = new Date(Date.UTC(yy, mm-1, dd));
    return isNaN(d.getTime()) ? null : d;
  }

  const digits = t.replace(/\D/g, "");
  if (digits.length === 8){
    const dd = +digits.slice(0,2);
    const mm = +digits.slice(2,4);
    const yy = +digits.slice(4,8);
    const d = new Date(Date.UTC(yy, mm-1, dd));
    return isNaN(d.getTime()) ? null : d;
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
function inRangeUTC(d, from, to){
  if (!hasValidDate(d)) return false;
  const x = d.getTime();
  if (from && x < from.getTime()) return false;
  if (to && x > to.getTime()) return false;
  return true;
}

function dayKey(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function emailKey(project, day, time){
  return `${project}|||${day}|||${time}`;
}

// ===================== Status
function statusFromRow({pay, appr, paid}){
  const hasPay = !!pay;
  const hasAppr = !!appr;
  const hasPaid = !!paid;
  if (hasPay && !hasAppr && !hasPaid) return "1";
  if (hasPay && hasAppr && !hasPaid) return "2";
  if (hasPay && hasAppr && hasPaid) return "3";
  return "";
}

// ===================== CSV
function parseCSV(text){
  const res = Papa.parse(text, {
    header:true,
    skipEmptyLines:true,
    dynamicTyping:false,
    transformHeader:(h)=>normalizeHeaderKey(h),
  });
  return res.data || [];
}

// ===================== Normalize
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

  const vendor = normText(row.vendor);
  const exactTime = normText(row.exact_time) || normText(row.Exacttime) || "";

  // "تم عمل إيميل" = vendor + exactTime + payment_request_date
  const hasEmail = !!vendor && !!exactTime && hasValidDate(payDate);

  // ✅ Columns confirmed by you
  const requestId = normText(row.request_id || row.requestId || row.requestID || "");
  const sourceRequestDate = parseDateSmart(row.source_request_date);
  const sourceRequestDateTxt = hasValidDate(sourceRequestDate) ? dayKey(sourceRequestDate) : (normText(row.source_request_date) || "—");

  // Optional: code if exists (won't break if missing)
  const code = normText(row.code || row.vendor_code || row.supplier_code || row["VendorCode"] || row["الكود"] || "");

  return {
    sectorKey, projectKey,
    sector, project,

    vendor,
    code,

    requestId,
    sourceRequestDate,
    sourceRequestDateTxt,

    exactTime,

    payDate, apprDate, paidDate,
    status: statusFromRow({pay:payDate, appr:apprDate, paid:paidDate}),

    amount_total,
    amount_paid,
    amount_canceled,
    effective_total,
    remaining,

    hasEmail,
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

// ===================== Filters
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
    if ((fromUTC || toUTC) && !inRangeUTC(r.payDate, fromUTC, toUTC)) return false;
    return true;
  });

  const meta = `المعروض: ${view.length} | قطاع: ${$("sector").selectedOptions[0]?.textContent || "الكل"} | مشروع: ${$("project").value || "الكل"} | حالة: ${$("status").selectedOptions[0]?.textContent || "الكل"}`;
  $("meta").textContent = meta;
}

function maxDateInView(){
  let ms = 0;
  view.forEach(r=>{
    if (hasValidDate(r.paidDate)) ms = Math.max(ms, r.paidDate.getTime());
    if (hasValidDate(r.payDate)) ms = Math.max(ms, r.payDate.getTime());
  });
  return ms ? new Date(ms) : null;
}

// ===================== Modal history (Back) — FIXED
let modalHistory = [];
let modalIsOpen = false;

function setBackButton(){
  const backBtn = $("insModalBack");
  backBtn.style.display = modalHistory.length ? "inline-flex" : "none";
}

function bindModalBack(){
  const backBtn = $("insModalBack");
  backBtn.onclick = ()=>{
    if (!modalHistory.length) return;
    const prev = modalHistory.pop();
    // ✅ Always re-render using stored function => handlers restored
    if (typeof prev.reRender === "function"){
      prev.reRender();
    }
    setBackButton();
  };
}

// openModal now expects reRender to be stored in history snapshot
function openModal({ title, sub, tabs = null, columns = [], rowsHtml = [], onRowClick = null, pushHistory = false, reRender = null }){
  const modal = $("insModal");
  const tabsEl = $("insTabs");
  const thead = $("insThead");
  const tbody = $("insTbody");

  // push current view as history before changing view
  if (pushHistory && modalIsOpen){
    modalHistory.push({ reRender }); // ✅ store renderer of previous screen
  }
  setBackButton();

  $("insModalTitle").textContent = title || "—";
  $("insModalSub").textContent = sub || "";

  tbody.onclick = null;

  const renderTable = (cols, rws, clickHandler)=>{
    thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
    tbody.innerHTML = rws.length ? rws.join("") : `<tr><td colspan="${cols.length}">لا توجد بيانات</td></tr>`;
    if (clickHandler){
      tbody.onclick = (e)=>{
        const tr = e.target.closest("tr[data-ekey]");
        if (!tr) return;
        clickHandler(tr.getAttribute("data-ekey"));
      };
    }else{
      tbody.onclick = null;
    }
  };

  if (tabs && tabs.length){
    tabsEl.style.display = "flex";
    tabsEl.classList.add("modal-tabs");
    tabsEl.innerHTML = tabs.map((t,i)=>`<button class="tab-btn" data-idx="${i}">${t.label}</button>`).join("");

    // default tab 0
    renderTable(tabs[0].columns, tabs[0].rowsHtml, tabs[0].onRowClick || null);

    tabsEl.querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        tabsEl.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");

        const idx = +btn.getAttribute("data-idx");
        const t = tabs[idx];
        renderTable(t.columns, t.rowsHtml, t.onRowClick || null);
      });
    });

    // set active on first
    const first = tabsEl.querySelector("button");
    if (first) first.classList.add("active");

  }else{
    tabsEl.style.display = "none";
    tabsEl.innerHTML = "";
    tabsEl.classList.remove("modal-tabs");
    renderTable(columns, rowsHtml, onRowClick || null);
  }

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");
  modalIsOpen = true;

  const close = ()=>{
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    $("insModalClose").removeEventListener("click", close);
    modal.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
    tbody.onclick = null;

    modalHistory = [];
    setBackButton();
    modalIsOpen = false;
  };
  const onBackdrop = (e)=>{ if(e.target===modal) close(); };
  const onEsc = (e)=>{ if(e.key==="Escape") close(); };

  $("insModalClose").addEventListener("click", close);
  modal.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

// ===================== Drill-down for ONE email group
function openEmailDetailsPopup({ title, sub, items, backRender }){
  const sorted = items.slice().sort((a,b)=>{
    const va = (a.vendor||"").localeCompare(b.vendor||"");
    if (va !== 0) return va;
    return (a.exactTime || "").localeCompare(b.exactTime || "");
  });

  const rowsHtml = sorted.map((r,i)=>{
    const pct = r.effective_total > 0 ? clamp(Math.round((r.amount_paid/r.effective_total)*100),0,100) : 0;
    return `
      <tr>
        <td>${i+1}</td>
        <td>${escHtml(r.project || "—")}</td>
        <td>${escHtml(r.sourceRequestDateTxt || "—")}</td>
        <td>${escHtml(r.requestId || "—")}</td>
        <td>${escHtml(r.code || "—")}</td>
        <td>${escHtml(r.vendor || "—")}</td>
        <td>${fmtMoney(r.effective_total)}</td>
        <td>${fmtMoney(r.amount_paid)}</td>
        <td>${fmtMoney(r.remaining)}</td>
        <td>${pct}%</td>
      </tr>
    `;
  });

  openModal({
    title,
    sub,
    columns: ["م","المشروع","تاريخ الطلب","رقم الطلب","الكود","اسم المورد","القيمة","المنصرف","المتبقي","%"],
    rowsHtml,
    pushHistory: true,
    reRender: backRender
  });
}

// ===================== Executive Summary + SLA (unchanged)
function renderExecutive(){
  const total = view.reduce((s,r)=>s+r.effective_total,0);
  const paidAll = view.reduce((s,r)=>s+r.amount_paid,0);
  const remain = view.reduce((s,r)=>s+r.remaining,0);

  $("k_total").textContent = fmtMoney(total);
  $("k_paid").textContent = fmtMoney(paidAll);
  $("k_remain").textContent = fmtMoney(remain);

  const asof = maxDateInView();
  $("asof").textContent = asof ? `As of: ${dayKey(asof)}` : "As of: —";

  const completed = view.filter(r=>hasValidDate(r.payDate) && hasValidDate(r.paidDate) && r.amount_paid > 0);

  let basePaid = 0;
  let okPaid = 0;

  completed.forEach(r=>{
    const d = daysBetween(r.payDate, r.paidDate);
    basePaid += r.amount_paid;
    if (d >= 0 && d <= 5) okPaid += r.amount_paid;
  });

  if (basePaid > 0){
    const pct = Math.round((okPaid / basePaid) * 100);
    $("sla_total").textContent = fmtMoney(basePaid);
    $("sla_paid").textContent = fmtMoney(okPaid);
    $("sla_pct").textContent = `${pct}%`;
  }else{
    $("sla_total").textContent = "—";
    $("sla_paid").textContent = "—";
    $("sla_pct").textContent = "—";
  }
}

// ===================== Cash Exposure
function buildEmailGroups(list){
  const groups = new Map();
  list.forEach(r=>{
    const day = hasValidDate(r.payDate) ? dayKey(r.payDate) : "—";
    const key = emailKey(r.project, day, r.exactTime);
    if (!groups.has(key)){
      groups.set(key, { project:r.project, day, time:r.exactTime, total:0, paid:0, remain:0, items:[] });
    }
    const g = groups.get(key);
    g.total += r.effective_total;
    g.paid += r.amount_paid;
    g.remain += r.remaining;
    g.items.push(r);
  });
  return groups;
}

function renderExposure(){
  const expRemain = { "1":0, "2":0, "3":0 };
  const expEmailCount = { "1":0, "2":0, "3":0 };

  ["1","2","3"].forEach(st=>{
    const list = view.filter(r=>r.status===st && r.remaining>0);
    expRemain[st] = list.reduce((s,r)=>s+r.remaining,0);

    const emailRows = list.filter(r=>r.hasEmail);
    const groups = buildEmailGroups(emailRows);
    expEmailCount[st] = groups.size; // true email count
  });

  $("exp_1").textContent = fmtMoney(expRemain["1"]);
  $("exp_2").textContent = fmtMoney(expRemain["2"]);
  $("exp_3").textContent = fmtMoney(expRemain["3"]);

  // ✅ better look will be via CSS class .kpi-action
  $("exp_1_count").classList.add("kpi-action");
  $("exp_2_count").classList.add("kpi-action");
  $("exp_3_count").classList.add("kpi-action");
  $("exp_all_count").classList.add("kpi-action");

  $("exp_1_count").textContent = `عدد الإيميلات: ${expEmailCount["1"]}`;
  $("exp_2_count").textContent = `عدد الإيميلات: ${expEmailCount["2"]}`;
  $("exp_3_count").textContent = `عدد الإيميلات: ${expEmailCount["3"]}`;

  const statusLabel =
    (s)=> s==="1" ? "بدون اعتماد ولم يحول" :
          s==="2" ? "معتمد ولم يحول" :
          "معتمد وتم تحويله (متبقي جزئي)";

  const openStatusEmails = (status)=>{
    const baseRows = view.filter(r=>r.status===status && r.remaining>0 && r.hasEmail);
    const groups = buildEmailGroups(baseRows);

    const arr = Array.from(groups.entries())
      .map(([ekey,g])=>({ ekey, ...g }))
      .sort((a,b)=> (b.day.localeCompare(a.day)) || (a.time.localeCompare(b.time)));

    const sumRemain = baseRows.reduce((s,r)=>s+r.remaining,0);

    const renderSummary = ()=>{
      const rowsHtml = arr.map(g=>{
        const pct = g.total>0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
        return `
          <tr data-ekey="${escHtml(g.ekey)}" style="cursor:pointer;">
            <td>${escHtml(g.project)}</td>
            <td>${g.day}</td>
            <td>${escHtml(g.time)}</td>
            <td>${fmtMoney(g.total)}</td>
            <td>${fmtMoney(g.paid)}</td>
            <td>${fmtMoney(g.remain)}</td>
            <td>${pct}%</td>
          </tr>
        `;
      });

      openModal({
        title: `إيميلات الحالة: ${statusLabel(status)}`,
        sub: `اضغط على أي سطر لعرض تفاصيل الإيميل | عدد الإيميلات: ${arr.length} | إجمالي المتبقي: ${fmtMoney(sumRemain)}`,
        columns: ["المشروع","اليوم","الوقت","صافي القيمة","المنصرف","المتبقي","%"],
        rowsHtml,
        onRowClick: (ekey)=>{
          const g = groups.get(ekey);
          if (!g) return;
          const pct = g.total>0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
          openEmailDetailsPopup({
            title: `تفاصيل الإيميل — ${g.project}`,
            sub: `اليوم: ${g.day} | الوقت: ${g.time} | إجمالي: ${fmtMoney(g.total)} | المنصرف: ${fmtMoney(g.paid)} | المتبقي: ${fmtMoney(g.remain)} | ${pct}%`,
            items: g.items,
            backRender: renderSummary
          });
        }
      });
    };

    // reset history on first open
    modalHistory = [];
    setBackButton();
    renderSummary();
  };

  $("exp_1_count").onclick = ()=> openStatusEmails("1");
  $("exp_2_count").onclick = ()=> openStatusEmails("2");
  $("exp_3_count").onclick = ()=> openStatusEmails("3");

  // ✅ Card 4: Remaining only + "Emails/Rows" label
  const remainingRowsAll = view.filter(r=>r.remaining > 0);
  const remainingTotalAll = remainingRowsAll.reduce((s,r)=>s+r.remaining,0);

  const withEmailRows = remainingRowsAll.filter(r=>r.hasEmail);
  const groupsAll = buildEmailGroups(withEmailRows);
  const emailsCountAll = groupsAll.size;
  const rowsCountAll = remainingRowsAll.length;

  $("exp_all").textContent = fmtMoney(remainingTotalAll);
  $("exp_all_count").textContent = `ميلات: ${emailsCountAll} / صفوف: ${rowsCountAll}`;

  $("exp_all_count").onclick = ()=>{
    const withoutEmailRows = remainingRowsAll.filter(r=>!r.hasEmail);

    const tab1Arr = Array.from(groupsAll.entries())
      .map(([ekey,g])=>({ ekey, ...g }))
      .sort((a,b)=> (b.day.localeCompare(a.day)) || (a.time.localeCompare(b.time)));

    const renderCard4 = ()=>{
      const tab1RowsHtml = tab1Arr.map(g=>{
        const pct = g.total>0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
        return `
          <tr data-ekey="${escHtml(g.ekey)}" style="cursor:pointer;">
            <td>${escHtml(g.project)}</td>
            <td>${g.day}</td>
            <td>${escHtml(g.time)}</td>
            <td>${fmtMoney(g.total)}</td>
            <td>${fmtMoney(g.paid)}</td>
            <td>${fmtMoney(g.remain)}</td>
            <td>${pct}%</td>
          </tr>
        `;
      });

      const tab2RowsHtml = withoutEmailRows.map((r,i)=>`
        <tr>
          <td>${i+1}</td>
          <td>${escHtml(r.project || "—")}</td>
          <td>${escHtml(r.sourceRequestDateTxt || "—")}</td>
          <td>${escHtml(r.requestId || "—")}</td>
          <td>${escHtml(r.code || "—")}</td>
          <td>${escHtml(r.vendor || "—")}</td>
          <td>${fmtMoney(r.effective_total)}</td>
        </tr>
      `);

      openModal({
        title: "المطالبات المتبقية — تفاصيل",
        sub: `إجمالي المتبقي: ${fmtMoney(remainingTotalAll)} | ميلات: ${emailsCountAll} | صفوف: ${rowsCountAll}`,
        tabs: [
          {
            label: `تم عمل إيميل (${tab1Arr.length} ميل)`,
            columns: ["المشروع","اليوم","الوقت","صافي القيمة","المنصرف","المتبقي","%"],
            rowsHtml: tab1RowsHtml,
            onRowClick: (ekey)=>{
              const g = groupsAll.get(ekey);
              if (!g) return;
              const pct = g.total>0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
              openEmailDetailsPopup({
                title: `تفاصيل الإيميل — ${g.project}`,
                sub: `اليوم: ${g.day} | الوقت: ${g.time} | إجمالي: ${fmtMoney(g.total)} | المنصرف: ${fmtMoney(g.paid)} | المتبقي: ${fmtMoney(g.remain)} | ${pct}%`,
                items: g.items,
                backRender: renderCard4
              });
            }
          },
          {
            label: `لم يتم عمل إيميل (${withoutEmailRows.length} صف)`,
            columns: ["م","المشروع","تاريخ الطلب","رقم الطلب","الكود","اسم المورد","القيمة"],
            rowsHtml: tab2RowsHtml
          }
        ]
      });
    };

    modalHistory = [];
    setBackButton();
    renderCard4();
  };
}

// ===================== Remaining sections (unchanged)
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

  const map = new Map();
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

  const wk = Array.from({length:7}, (_,i)=>({ i, sum:0, count:0 }));
  paid30.forEach(r=>{
    const day = r.paidDate.getUTCDay();
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

  const totalPaid30 = paid30.reduce((s,r)=>s+r.amount_paid,0);
  const avg = totalPaid30 / 30;

  $("fc_avg").textContent = fmtMoney(avg);
  $("fc_7").textContent = fmtMoney(avg * 7);
  $("fc_14").textContent = fmtMoney(avg * 14);
}

function renderDataQuality(){
  const total = view.length || 1;

  const metrics = [
    { label:"طلبات بدون تاريخ طلب صرف", test:(r)=>!hasValidDate(r.payDate) },
    { label:"صفوف بدون مورد", test:(r)=>!normText(r.vendor) },
    { label:"صفوف حالة غير محددة (تواريخ ناقصة)", test:(r)=>!r.status },
    { label:"صفوف بدون مشروع", test:(r)=>!normText(r.project) || r.project==="(بدون مشروع)" },
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

// ===================== Render
function renderAll(){
  applyFilters();
  renderExecutive();
  renderExposure();
  renderAging();
  renderBottlenecks();
  renderWeekPatternAndForecast();
  renderDataQuality();
}

// ===================== Init
async function init(){
  bindModalBack();

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

  projectsBySector = new Map();
  rows.forEach(r=>{
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  $("sector").innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk=>`<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

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
