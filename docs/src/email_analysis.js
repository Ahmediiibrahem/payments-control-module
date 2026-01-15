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

/* ✅ Date parser (Excel serial / ISO / ddmmyyyy / dd/mm/yyyy) */
function parseDateSmart(txt){
  if (txt === null || txt === undefined) return null;
  const s0 = String(txt).trim();
  if (!s0) return null;

  // Excel serial
  if (/^\d+(\.\d+)?$/.test(s0)) {
    const num = Number(s0);
    if (num > 20000 && num < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30));
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

  // 8 digits: ddmmyyyy or yyyymmdd
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
function dayNameAr(d){
  const names = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  return names[d.getUTCDay()] || "";
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

function fmtDateDDMMMYYYY(d){
  if (!(d instanceof Date) || isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2,"0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mmm = months[d.getUTCMonth()] || "—";
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mmm}-${yyyy}`;
}

function parseCSV(text){
  const res = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => normalizeHeaderKey(h),
  });
  if (res.errors && res.errors.length) console.warn("CSV parse errors:", res.errors.slice(0, 10));
  return res.data || [];
}

// ---------- Flexible getters ----------
function findKeyContains(raw, parts){
  const keys = Object.keys(raw || {});
  for (const k of keys){
    const kn = k.toLowerCase();
    if (parts.every(p => kn.includes(p))) return k;
  }
  return null;
}
function pickTime(raw){
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
function pickVendorCode(raw){
  // مرن جدًا عشان اختلاف أسماء الأعمدة
  const k =
    raw.Vendor_Code !== undefined ? "Vendor_Code" :
    raw.vendor_code !== undefined ? "vendor_code" :
    raw.VendorCode !== undefined ? "VendorCode" :
    raw.vendorcode !== undefined ? "vendorcode" :
    raw.Vendor_ID !== undefined ? "Vendor_ID" :
    raw.vendor_id !== undefined ? "vendor_id" :
    findKeyContains(raw, ["vendor", "code"]) ||
    findKeyContains(raw, ["vendor", "id"]);
  return k ? String(raw[k]).trim() : "";
}
function pickDates(raw){
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

// ---------- Data ----------
let data = [];
let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

function normalizeRow(raw){
  const mapped = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = normalizeHeaderKey(k);
    const m = HEADER_MAP[kk] || kk;
    mapped[m] = v;
  }

  const sector = pickSector(mapped) || pickSector(raw) || "(بدون قطاع)";
  const project = pickProject(mapped) || pickProject(raw) || "(بدون مشروع)";
  const vendor = pickVendor(mapped) || pickVendor(raw) || "";
  const vendorCode = pickVendorCode(mapped) || pickVendorCode(raw) || "";
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

  const sectorKey = normText(sector);
  const projectKey = normText(project);

  if (sectorKey) sectorLabelByKey.set(sectorKey, sector);
  if (projectKey) projectLabelByKey.set(projectKey, project);

  return {
    sector, project, vendor, vendorCode,
    sectorKey, projectKey,
    time,
    _timeMin: timeToMinutes(time),
    _emailDate: emailDate,
    amount_paid,
    effective_total,
    _status: statusFromDates(pay, appr, paid),
  };
}

// ---------- Filters ----------
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

/* ✅ Vendor مش شرط */
function rowsEmailsOnly(rows){
  return (rows || []).filter(r => r.time && r._emailDate);
}

// ---------- Grouping (✅ Email = Day + Time فقط) ----------
function groupEmails(rows){
  const map = new Map();

  for (const r of rows){
    const dlab = dayLabel(r._emailDate);
    const key = `${dlab}|||${r.time}`;

    if (!map.has(key)){
      map.set(key, {
        key,
        day: dlab,
        dayName: dayNameAr(r._emailDate),
        time: r.time,
        timeMin: r._timeMin,
        date: r._emailDate,
        status: r._status,

        // dominant display
        sector: "(—)",
        project: "(—)",
        sectorKey: "",
        projectKey: "",

        // membership
        sectorKeys: new Set(),
        projectKeys: new Set(),

        // totals
        total: 0,
        paid: 0,

        // dominant chooser
        _byProj: new Map(), // projectKey -> {sectorKey, sector, project, total}

        // details
        rows: []
      });
    }

    const g = map.get(key);

    g.total += r.effective_total;
    g.paid  += r.amount_paid;
    g.rows.push(r);

    if (r.sectorKey) g.sectorKeys.add(r.sectorKey);
    if (r.projectKey) g.projectKeys.add(r.projectKey);

    const pk = r.projectKey || "(no_project)";
    if (!g._byProj.has(pk)){
      g._byProj.set(pk, {
        projectKey: r.projectKey || "",
        sectorKey: r.sectorKey || "",
        sector: r.sector || "(—)",
        project: r.project || "(—)",
        total: 0
      });
    }
    g._byProj.get(pk).total += r.effective_total;
  }

  const out = [];
  for (const g of map.values()){
    let best = null;
    for (const x of g._byProj.values()){
      if (!best || x.total > best.total) best = x;
    }
    if (best){
      g.sector = best.sector;
      g.project = best.project;
      g.sectorKey = best.sectorKey;
      g.projectKey = best.projectKey;
    }
    delete g._byProj;
    out.push(g);
  }

  return out;
}

function filterGroups(groups){
  const sectorKey = $("sector").value;
  const projectLabel = $("project").value;
  const projectKey = normText(projectLabel);
  const status = $("status")?.value || "";
  const { fromUTC, toUTC } = getFilterRange();

  return (groups || []).filter(g=>{
    if (status && g.status !== status) return false;
    if ((fromUTC || toUTC) && !inRangeUTC(g.date, fromUTC, toUTC)) return false;
    if (sectorKey && !g.sectorKeys?.has(sectorKey)) return false;
    if (projectKey && !g.projectKeys?.has(projectKey)) return false;
    return true;
  });
}

// ---------- KPI Top Project ----------
function setTopProjectKPIs(groups){
  const byCount = new Map();
  const byValue = new Map();

  for (const g of (groups || [])){
    const p = g.project || "(بدون مشروع)";
    byCount.set(p, (byCount.get(p) || 0) + 1);
    byValue.set(p, (byValue.get(p) || 0) + (g.total||0));
  }

  let topCountP="—", topCount=0;
  for (const [p,c] of byCount.entries()){
    if (c > topCount){ topCount=c; topCountP=p; }
  }

  let topValP="—", topVal=0;
  for (const [p,v] of byValue.entries()){
    if (v > topVal){ topVal=v; topValP=p; }
  }

  $("kpi_top_count_line").textContent = topCountP==="—" ? "عدد: —" : `عدد: ${topCountP} (${topCount})`;
  $("kpi_top_value_line").textContent = topValP==="—" ? "قيمة: —" : `قيمة: ${topValP} (${fmtMoney(topVal)})`;
}

// =====================
// Drill Modal
// =====================
let __drillStack = [];

function openDrill(){
  const m = $("drillModal");
  m.classList.add("show");
  m.setAttribute("aria-hidden","false");

  const close = ()=>{
    m.classList.remove("show");
    m.setAttribute("aria-hidden","true");
    __drillStack = [];
    $("drillClose").removeEventListener("click", close);
    m.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
  };
  const onBackdrop = (e)=>{ if (e.target === m) close(); };
  const onEsc = (e)=>{ if (e.key === "Escape") close(); };

  $("drillClose").addEventListener("click", close);
  m.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

function setBackVisible(){
  const b = $("drillBack");
  b.style.display = __drillStack.length ? "inline-flex" : "none";
  b.onclick = ()=>{
    if (!__drillStack.length) return;
    const fn = __drillStack.pop();
    if (typeof fn === "function") fn();
    setBackVisible();
  };
}

/* ✅ (المطلوب الجديد) تفاصيل الإيميل */
function drillRenderEmailDetails(g){
  const title = $("drillTitle");
  const sub = $("drillSub");
  const thead = $("drillThead");
  const tbody = $("drillTbody");

  const total = g?.total || 0;
  const paid = g?.paid || 0;
  const remain = Math.max(0, total - paid);
  const pct = total > 0 ? clamp(Math.round((paid/total)*100),0,100) : 0;

  // ✅ Title: Sector - Project - % صرف
  title.textContent = `${g?.sector || "—"} — ${g?.project || "—"} — ${pct}%`;

  // ✅ Sub: التاريخ: dd-mmm-yyyy (اليوم) - الوقت - الإجمالي - المنصرف - المتبقي
  const dTxt = fmtDateDDMMMYYYY(g?.date);
  sub.textContent =
    `التاريخ: ${dTxt} (${g?.dayName || "—"}) - الوقت: ${g?.time || "—"} - الإجمالي: ${fmtMoney(total)} - المنصرف: ${fmtMoney(paid)} - المتبقي: ${fmtMoney(remain)}`;

  // ✅ Columns: م | كود المورد | اسم المورد | القيمة | المنصرف | المتبقي | النسبة
  thead.innerHTML = `
    <tr>
      <th>م</th>
      <th>كود المورد</th>
      <th>اسم المورد</th>
      <th>القيمة</th>
      <th>المنصرف</th>
      <th>المتبقي</th>
      <th>%</th>
    </tr>
  `;

  const rows = (g?.rows || []);
  tbody.innerHTML = rows.map((r,i)=>{
    const val = r.effective_total || 0;
    const p = r.amount_paid || 0;
    const rem = Math.max(0, val - p);
    const pp = val > 0 ? clamp(Math.round((p/val)*100),0,100) : 0;
    return `
      <tr>
        <td>${i+1}</td>
        <td>${escHtml(r.vendorCode || "—")}</td>
        <td>${escHtml(r.vendor || "—")}</td>
        <td>${fmtMoney(val)}</td>
        <td>${fmtMoney(p)}</td>
        <td>${fmtMoney(rem)}</td>
        <td>${pp}%</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">لا توجد بيانات</td></tr>`;

  setBackVisible();
}

// ---------- Chart ----------
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

    return `
      <div class="chart-group" data-day="${dl}">
        <div class="chart-bars" title="${has ? `Total: ${fmtMoney(a.total)} | Paid: ${fmtMoney(a.paid)} | ${pct}%` : "No emails"}">
          <div class="bar-stack" style="height:${has ? 100 : 0}%; overflow:visible;">
            <div class="bar-top-value">${has ? fmtMoney(a.total) : ""}</div>
            ${has ? `
              <div class="bar-paid" style="height:${pct}%; min-height:${pct>0 ? 18 : 0}px;">
                <div class="bar-percent">${pct}%</div>
              </div>
            ` : ``}
          </div>
        </div>
        <div class="chart-day">${dl}</div>
      </div>
    `;
  }).join("");

  // click day => list emails of day
  chart.querySelectorAll(".chart-group").forEach(el=>{
    el.addEventListener("click", ()=>{
      const day = el.getAttribute("data-day");
      const list = valid.filter(g => g.day === day).sort((a,b)=> (b.timeMin||0) - (a.timeMin||0));

      openDrill();
      __drillStack = [];
      setBackVisible();

      const title = $("drillTitle");
      const sub = $("drillSub");
      const thead = $("drillThead");
      const tbody = $("drillTbody");

      title.textContent = `إيميلات يوم: ${day}`;
      sub.textContent = `عدد الإيميلات: ${list.length}`;

      thead.innerHTML = `
        <tr>
          <th>الوقت</th>
          <th>القطاع</th>
          <th>المشروع</th>
          <th>الإجمالي</th>
          <th>المنصرف</th>
          <th>المتبقي</th>
          <th>%</th>
        </tr>
      `;

      tbody.innerHTML = list.map((g)=>{
        const remain = Math.max(0, g.total - g.paid);
        const pp = g.total > 0 ? clamp(Math.round((g.paid/g.total)*100),0,100) : 0;
        return `
          <tr data-key="${escHtml(g.key)}" style="cursor:pointer;">
            <td>${escHtml(g.time)}</td>
            <td>${escHtml(g.sector)}</td>
            <td>${escHtml(g.project)}</td>
            <td>${fmtMoney(g.total)}</td>
            <td>${fmtMoney(g.paid)}</td>
            <td>${fmtMoney(remain)}</td>
            <td>${pp}%</td>
          </tr>
        `;
      }).join("") || `<tr><td colspan="7">لا توجد بيانات</td></tr>`;

      tbody.onclick = (e)=>{
        const tr = e.target.closest("tr[data-key]");
        if (!tr) return;
        const key = tr.getAttribute("data-key");
        const g = list.find(x => x.key === key);
        if (!g) return;

        drillRenderEmailDetails(g);
      };
    });
  });
}

// ✅ Details table: one row per email
function renderDetailTable(groups){
  const tbody = $("detail_rows");

  const sorted = (groups || []).slice().sort((a,b)=>{
    const ad = a.date?.getTime() || 0;
    const bd = b.date?.getTime() || 0;
    if (bd !== ad) return bd - ad;
    return (b.timeMin||0) - (a.timeMin||0);
  });

  tbody.innerHTML = sorted.map((g)=>{
    const remain = Math.max(0, g.total - g.paid);
    const pct = g.total > 0 ? clamp(Math.round((g.paid / g.total) * 100), 0, 100) : 0;

    return `
      <tr data-key="${escHtml(g.key)}" style="cursor:pointer;">
        <td>${escHtml(g.sector)}</td>
        <td>${escHtml(g.project)}</td>
        <td>${g.day}</td>
        <td>${escHtml(g.dayName)}</td>
        <td>${escHtml(g.time)}</td>
        <td>${fmtMoney(g.total)}</td>
        <td>${fmtMoney(g.paid)}</td>
        <td>${fmtMoney(remain)}</td>
        <td>${pct}%</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9">لا توجد بيانات</td></tr>`;

  tbody.onclick = (e)=>{
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.getAttribute("data-key");
    const g = sorted.find(x => x.key === key);
    if (!g) return;

    openDrill();
    __drillStack = [];
    setBackVisible();
    drillRenderEmailDetails(g);
  };
}

// ---------- Dropdown helpers ----------
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

// ---------- Render ----------
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

// ---------- Init ----------
async function init(){
  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if (!res.ok){
    alert("مش قادر أقرأ الداتا من المصدر (CSV).");
    return;
  }

  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);

  projectsBySector = new Map();
  for (const r of data){
    if (!r.sectorKey || !r.projectKey) continue;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  }

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
