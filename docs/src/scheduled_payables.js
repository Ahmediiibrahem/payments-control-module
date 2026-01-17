import { HEADER_MAP } from "./schema.js";
import { DATA_SOURCE } from "./config.js";

const $ = (id) => document.getElementById(id);

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
  const v = String(x ?? "").replace(/,/g, "").trim();
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function normalizeHeaderKey(h){
  return String(h ?? "").trim().replace(/\s+/g, "_");
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
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s0);
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

function parseCSV(text){
  const res = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => normalizeHeaderKey(h),
  });
  return res.data || [];
}

function todayUTC0(){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function daysBetweenUTC(d, baseUTC0){
  const ms = 24*60*60*1000;
  return Math.ceil((d.getTime() - baseUTC0.getTime()) / ms);
}
function statusOf(out, date, t0){
  if (out <= 0) return "مسدد";
  if (date.getTime() < t0.getTime()) return "متأخر";
  return "قادم";
}

// ---------- State ----------
let RAW = [];        // line-level (request_id contains "مستحقات")
let GROUPS_ALL = []; // grouped vendor+date

// All Vendors state
let ALLV = [];       // unique vendors aggregated
let ALLV_FILTERED = [];
let ALLV_PAGE = 1;
const ALLV_PAGE_SIZE = 25;

function isScheduledPayable(r){
  return normText(r.request_id).includes(normText("مستحقات"));
}

function mapRow(raw){
  // map headers with schema map
  const mapped = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = normalizeHeaderKey(k);
    const m = HEADER_MAP[kk] || kk;
    mapped[m] = v;
  }

  const request_id = String(mapped.request_id ?? "").trim();
  const vendor = String(mapped.vendor ?? "").trim();

  const code = String(mapped.code ?? "").trim();
  const description = String(mapped.Description ?? mapped.description ?? "").trim();

  // ✅ مسلسل المستحقات (العمود الجديد)
  // نحاول بأكثر من اسم محتمل
  const serialRaw =
    mapped["مسلسل_المستحقات"] ??
    mapped["مسلسل المستحقات"] ??
    mapped.serial_payables ??
    mapped.serial ??
    "";

  const serial = String(serialRaw ?? "").trim(); // "1".."33"

  const d = parseDateSmart(mapped.source_request_date);

  const amount_total = toNumber(mapped.amount_total);
  const amount_paid = toNumber(mapped.amount_paid);
  const amount_canceled = toNumber(mapped.amount_canceled);

  const value = Math.max(0, amount_total - amount_canceled);
  const paid = Math.max(0, amount_paid);
  const out = Math.max(0, value - paid);

  return { request_id, vendor, code, description, serial, date: d, value, paid, out };
}

// Group by Vendor + Date
function group(rows){
  const m = new Map();
  for (const r of rows){
    if (!r.vendor) continue;
    if (!(r.date instanceof Date) || isNaN(r.date.getTime())) continue;

    const key = `${normText(r.vendor)}|||${dayLabel(r.date)}`;
    if (!m.has(key)){
      m.set(key, {
        key,
        vendor: r.vendor,
        vendorKey: normText(r.vendor),
        date: r.date,
        dateLabel: dayLabel(r.date),
        gross: 0,
        paid: 0,
        out: 0,
        lines: []
      });
    }
    const g = m.get(key);
    g.gross += r.value;
    g.paid += r.paid;
    g.out += r.out;
    g.lines.push(r);
  }
  return Array.from(m.values());
}

function openModal(){
  const m = $("spModal");
  m.classList.add("show");
  m.setAttribute("aria-hidden","false");

  const close = ()=>{
    m.classList.remove("show");
    m.setAttribute("aria-hidden","true");
    $("spModalClose").removeEventListener("click", close);
    m.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onEsc);
  };
  const onBackdrop = (e)=>{ if (e.target === m) close(); };
  const onEsc = (e)=>{ if (e.key === "Escape") close(); };

  $("spModalClose").addEventListener("click", close);
  m.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onEsc);
}

function renderLinesModal(title, sub, lines, opts = {}){
  const showVendorCol = !!opts.showVendor;

  $("spModalTitle").textContent = title;
  $("spModalSub").textContent = sub;

  $("spModalThead").innerHTML = showVendorCol ? `
    <tr>
      <th>م</th>
      <th>الكود</th>
      <th>اسم المورد</th>
      <th>الوصف</th>
      <th>تاريخ الاستحقاق</th>
      <th>القيمة</th>
      <th>المنصرف</th>
      <th>المتبقي</th>
    </tr>
  ` : `
    <tr>
      <th>م</th>
      <th>الكود</th>
      <th>الوصف</th>
      <th>تاريخ الاستحقاق</th>
      <th>القيمة</th>
      <th>المنصرف</th>
      <th>المتبقي</th>
    </tr>
  `;

  const rowsHtml = (lines || []).map((r, i)=>{
    const dateTxt = r.date ? dayLabel(r.date) : "—";

    if (showVendorCol){
      return `
        <tr>
          <td>${i+1}</td>
          <td>${escHtml(r.code || "—")}</td>
          <td>${escHtml(r.vendor || "—")}</td>
          <td>${escHtml(r.description || "—")}</td>
          <td>${dateTxt}</td>
          <td>${fmtMoney(r.value)}</td>
          <td>${fmtMoney(r.paid)}</td>
          <td>${fmtMoney(r.out)}</td>
        </tr>
      `;
    }

    return `
      <tr>
        <td>${i+1}</td>
        <td>${escHtml(r.code || "—")}</td>
        <td>${escHtml(r.description || "—")}</td>
        <td>${dateTxt}</td>
        <td>${fmtMoney(r.value)}</td>
        <td>${fmtMoney(r.paid)}</td>
        <td>${fmtMoney(r.out)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="${showVendorCol ? 8 : 7}">لا توجد بيانات</td></tr>`;

  $("spModalRows").innerHTML = rowsHtml;
  openModal();
}

function getFilters(){
  const vendorTxt = $("vendor").value;
  const statusTxt = $("status").value; // "", "مسدد", "متأخر", "قادم"
  const from = parseDateSmart($("date_from_txt").value);
  const to = parseDateSmart($("date_to_txt").value);

  const fromUTC = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0,0,0)) : null;
  const toUTC = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23,59,59)) : null;

  return { vKey: normText(vendorTxt), fromUTC, toUTC, status: statusTxt };
}

function inRange(d, fromUTC, toUTC){
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  if (fromUTC && d.getTime() < fromUTC.getTime()) return false;
  if (toUTC && d.getTime() > toUTC.getTime()) return false;
  return true;
}

// line-level (for popups)
function filteredLines(){
  const { vKey, fromUTC, toUTC, status } = getFilters();
  const t0 = todayUTC0();

  return RAW.filter(r=>{
    if (vKey && normText(r.vendor) !== vKey) return false;
    if ((fromUTC || toUTC) && !inRange(r.date, fromUTC, toUTC)) return false;

    if (status){
      const st = statusOf(r.out, r.date, t0);
      if (st !== status) return false;
    }
    return true;
  });
}

// group-level (for KPIs + tables)
function filteredGroups(){
  const { vKey, fromUTC, toUTC, status } = getFilters();
  const t0 = todayUTC0();

  return GROUPS_ALL.filter(g=>{
    if (vKey && g.vendorKey !== vKey) return false;
    if ((fromUTC || toUTC) && !inRange(g.date, fromUTC, toUTC)) return false;

    if (status){
      const st = statusOf(g.out, g.date, t0);
      if (st !== status) return false;
    }
    return true;
  });
}

function renderKPIs(groups){
  const gross = groups.reduce((a,g)=>a+g.gross,0);
  const paid = groups.reduce((a,g)=>a+g.paid,0);
  const out = groups.reduce((a,g)=>a+g.out,0);

  const grossCnt = groups.length;
  const paidCnt = groups.filter(g=>g.paid>0).length;
  const outCnt = groups.filter(g=>g.out>0).length;

  const t0 = todayUTC0();
  const overdueGroups = groups.filter(g => g.out>0 && g.date.getTime() < t0.getTime());
  const overdueAmt = overdueGroups.reduce((a,g)=>a+g.out,0);

  $("kpi_gross").textContent = fmtMoney(gross);
  $("kpi_gross_cnt").textContent = `عدد البنود: ${grossCnt}`;

  $("kpi_paid").textContent = fmtMoney(paid);
  $("kpi_paid_cnt").textContent = `بنود عليها صرف: ${paidCnt}`;

  $("kpi_out").textContent = fmtMoney(out);
  $("kpi_out_cnt").textContent = `بنود غير مسددة: ${outCnt}`;

  $("kpi_overdue").textContent = fmtMoney(overdueAmt);
  $("kpi_overdue_cnt").textContent = `عدد البنود: ${overdueGroups.length}`;
}

function renderBuckets(groups){
  const t0 = todayUTC0();
  const buckets = { b7:{amt:0,cnt:0}, b14:{amt:0,cnt:0}, b30:{amt:0,cnt:0}, b30p:{amt:0,cnt:0} };

  for (const g of groups){
    if (g.out <= 0) continue;
    if (g.date.getTime() < t0.getTime()) continue;

    const days = daysBetweenUTC(g.date, t0);
    if (days <= 7)  { buckets.b7.amt += g.out; buckets.b7.cnt++; continue; }
    if (days <= 14) { buckets.b14.amt += g.out; buckets.b14.cnt++; continue; }
    if (days <= 30) { buckets.b30.amt += g.out; buckets.b30.cnt++; continue; }
    buckets.b30p.amt += g.out; buckets.b30p.cnt++;
  }

  $("b7_amt").textContent = fmtMoney(buckets.b7.amt);
  $("b7_cnt").textContent = `عدد البنود: ${buckets.b7.cnt}`;

  $("b14_amt").textContent = fmtMoney(buckets.b14.amt);
  $("b14_cnt").textContent = `عدد البنود: ${buckets.b14.cnt}`;

  $("b30_amt").textContent = fmtMoney(buckets.b30.amt);
  $("b30_cnt").textContent = `عدد البنود: ${buckets.b30.cnt}`;

  $("b30p_amt").textContent = fmtMoney(buckets.b30p.amt);
  $("b30p_cnt").textContent = `عدد البنود: ${buckets.b30p.cnt}`;
}

function renderTopVendors(groups){
  const by = new Map();
  for (const g of groups){
    if (g.out <= 0) continue;
    if (!by.has(g.vendorKey)) by.set(g.vendorKey, { vendor:g.vendor, vendorKey:g.vendorKey, out:0, cnt:0 });
    const x = by.get(g.vendorKey);
    x.out += g.out;
    x.cnt += 1;
  }
  const top = Array.from(by.values()).sort((a,b)=>b.out - a.out).slice(0,5);

  $("top_vendors").innerHTML = top.map((x,i)=>`
    <tr class="clickable-row" data-vkey="${escHtml(x.vendorKey)}">
      <td>${i+1}</td>
      <td>${escHtml(x.vendor)}</td>
      <td>${fmtMoney(x.out)}</td>
      <td>${x.cnt}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">لا توجد بيانات</td></tr>`;

  $("top_vendors").onclick = (e)=>{
    const tr = e.target.closest("tr[data-vkey]");
    if (!tr) return;
    const vkey = tr.getAttribute("data-vkey");
    const t0 = todayUTC0();
    const { fromUTC, toUTC, status } = getFilters();

    const lines = RAW.filter(r=>{
      if (normText(r.vendor) !== vkey) return false;
      if ((fromUTC || toUTC) && !inRange(r.date, fromUTC, toUTC)) return false;
      if (status){
        const st = statusOf(r.out, r.date, t0);
        if (st !== status) return false;
      }
      return r.out > 0;
    })
    // ✅ Popup Top5: oldest -> newest
    .sort((a,b)=> a.date.getTime() - b.date.getTime());

    const outSum = lines.reduce((a,r)=>a+r.out,0);
    const paidSum = lines.reduce((a,r)=>a+r.paid,0);
    const valSum = lines.reduce((a,r)=>a+r.value,0);

    renderLinesModal(
      `تفاصيل Vendor: ${lines[0]?.vendor || "—"}`,
      `القيمة: ${fmtMoney(valSum)} | المنصرف: ${fmtMoney(paidSum)} | المتبقي: ${fmtMoney(outSum)} | عدد البنود: ${lines.length}`,
      lines,
      { showVendor: false }
    );
  };
}

function renderTable(groups){
  const t0 = todayUTC0();
  const order = { "متأخر": 1, "قادم": 2, "مسدد": 3 };

  const sorted = groups.slice().sort((a,b)=>{
    const sa = statusOf(a.out, a.date, t0);
    const sb = statusOf(b.out, b.date, t0);

    if (order[sa] !== order[sb]) return order[sa] - order[sb];

    // same status
    // قادم: الأقرب -> الأبعد
    // متأخر/مسدد: الأقدم -> الأحدث
    return a.date.getTime() - b.date.getTime();
  });

  $("rows").innerHTML = sorted.map(g=>{
    const st = statusOf(g.out, g.date, t0);
    const days = daysBetweenUTC(g.date, t0);
    const daysTxt = (st === "مسدد") ? "—" : (st === "متأخر" ? Math.abs(days) : days);

    return `
      <tr class="clickable-row" data-key="${escHtml(g.key)}">
        <td>${g.dateLabel}</td>
        <td>${escHtml(g.vendor)}</td>
        <td>${fmtMoney(g.gross)}</td>
        <td>${fmtMoney(g.paid)}</td>
        <td>${fmtMoney(g.out)}</td>
        <td>${st}</td>
        <td>${daysTxt}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">لا توجد بيانات</td></tr>`;

  $("rows").onclick = (e)=>{
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.getAttribute("data-key");
    const g = sorted.find(x=>x.key===key);
    if (!g) return;

    const lines = (g.lines || []).slice();
    const valSum = lines.reduce((a,r)=>a+r.value,0);
    const paidSum = lines.reduce((a,r)=>a+r.paid,0);
    const outSum = lines.reduce((a,r)=>a+r.out,0);

    renderLinesModal(
      `${g.vendor} — ${g.dateLabel}`,
      `القيمة: ${fmtMoney(valSum)} | المنصرف: ${fmtMoney(paidSum)} | المتبقي: ${fmtMoney(outSum)} | عدد البنود: ${lines.length}`,
      lines,
      { showVendor: false }
    );
  };
}

function renderMeta(allGroups, shownGroups){
  const vendorTxt = $("vendor").value || "الكل";
  const statusTxt = $("status").value || "الكل";
  $("meta").textContent = `المعروض: ${shownGroups.length} من ${allGroups.length} | Vendor: ${vendorTxt} | حالة: ${statusTxt}`;
}

// ✅ Popups for 8 cards ONLY (oldest -> newest)
function popupFor(type){
  const t0 = todayUTC0();
  const lines = filteredLines();

  let filtered = [];
  let title = "";

  if (type === "gross"){
    filtered = lines.slice();
    title = "تفاصيل إجمالي المستحقات (Gross)";
  } else if (type === "paid"){
    filtered = lines.filter(r => r.paid > 0);
    title = "تفاصيل المسدد (Paid)";
  } else if (type === "out"){
    filtered = lines.filter(r => r.out > 0);
    title = "تفاصيل المتبقي (Outstanding)";
  } else if (type === "overdue"){
    filtered = lines.filter(r => r.out > 0 && r.date.getTime() < t0.getTime());
    title = "تفاصيل المستحق والمتأخر (Overdue)";
  } else if (type === "b7" || type === "b14" || type === "b30" || type === "b30p"){
    const maxDays = (type === "b7") ? 7 : (type === "b14") ? 14 : (type === "b30") ? 30 : Infinity;
    title =
      type === "b7" ? "تفاصيل القادم خلال 7 أيام" :
      type === "b14" ? "تفاصيل القادم خلال 14 يوم" :
      type === "b30" ? "تفاصيل القادم خلال 30 يوم" :
      "تفاصيل القادم بعد 30 يوم";

    filtered = lines.filter(r=>{
      if (r.out <= 0) return false;
      if (r.date.getTime() < t0.getTime()) return false;
      const days = daysBetweenUTC(r.date, t0);
      if (maxDays === Infinity) return days > 30;
      return days <= maxDays;
    });
  } else {
    return;
  }

  filtered.sort((a,b)=> a.date.getTime() - b.date.getTime());

  const valSum = filtered.reduce((a,r)=>a+r.value,0);
  const paidSum = filtered.reduce((a,r)=>a+r.paid,0);
  const outSum = filtered.reduce((a,r)=>a+r.out,0);

  renderLinesModal(
    title,
    `القيمة: ${fmtMoney(valSum)} | المنصرف: ${fmtMoney(paidSum)} | المتبقي: ${fmtMoney(outSum)} | عدد البنود: ${filtered.length}`,
    filtered,
    { showVendor: true }
  );
}

/* -------------------- All Vendors (Unique) -------------------- */

function buildAllVendorsFromRaw(rawRows){
  const m = new Map(); // vendorKey -> agg

  for (const r of rawRows){
    if (!r.vendor) continue;
    if (!(r.date instanceof Date) || isNaN(r.date.getTime())) continue;

    const k = normText(r.vendor);
    if (!m.has(k)){
      m.set(k, {
        vendor: r.vendor,
        vendorKey: k,
        // "الكود" (لو عندك Vendor code فعليًا يبقى هنغيره بعدين)
        code: r.code || "",
        // مسلسل المستحقات
        serial: r.serial || "",
        gross: 0,
        paid: 0,
        out: 0,
        minDate: r.date,
        maxDate: r.date
      });
    }
    const x = m.get(k);

    // أفضل كود/مسلسل لو ظهروا لاحقًا
    if (!x.code && r.code) x.code = r.code;
    if (!x.serial && r.serial) x.serial = r.serial;

    x.gross += r.value;
    x.paid += r.paid;
    x.out += r.out;

    if (r.date.getTime() < x.minDate.getTime()) x.minDate = r.date;
    if (r.date.getTime() > x.maxDate.getTime()) x.maxDate = r.date;
  }

  // sort by outstanding desc (executive friendly)
  return Array.from(m.values()).sort((a,b)=> (b.out||0) - (a.out||0));
}

function applyAllVendorsSearch(){
  const q = normText($("all_search").value);
  if (!q){
    ALLV_FILTERED = ALLV.slice();
  } else {
    ALLV_FILTERED = ALLV.filter(x=>{
      const hay = normText(`${x.serial} ${x.code} ${x.vendor}`);
      return hay.includes(q);
    });
  }
  ALLV_PAGE = 1;
}

function renderAllVendors(){
  if (!$("all_vendors")) return;

  const total = ALLV_FILTERED.length;
  const pages = Math.max(1, Math.ceil(total / ALLV_PAGE_SIZE));
  ALLV_PAGE = Math.max(1, Math.min(ALLV_PAGE, pages));

  const start = (ALLV_PAGE - 1) * ALLV_PAGE_SIZE;
  const slice = ALLV_FILTERED.slice(start, start + ALLV_PAGE_SIZE);

  $("all_page_info").textContent = `Page ${ALLV_PAGE} / ${pages} — Rows: ${total}`;

  const rows = slice.map((x, idx)=>{
    const n = start + idx + 1;

    const firstDue = x.minDate ? dayLabel(x.minDate) : "—";
    const lastDue  = x.maxDate ? dayLabel(x.maxDate) : "—";

    // ✅ PDF link based on serial
    const hasSerial = String(x.serial || "").trim() !== "";
    const pdfHref = hasSerial ? `./assets/pdf/${encodeURIComponent(String(x.serial).trim())}.pdf` : "";
    const pdfCell = hasSerial
      ? `<a href="${pdfHref}" target="_blank" rel="noopener">PDF</a>`
      : `—`;

    return `
      <tr>
        <td>${n}</td>
        <td>${escHtml(x.code || "—")}</td>
        <td>${escHtml(x.vendor)}</td>
        <td>${fmtMoney(x.gross)}</td>
        <td>${fmtMoney(x.paid)}</td>
        <td>${fmtMoney(x.out)}</td>
        <td>${firstDue}</td>
        <td>${lastDue}</td>
        <td>${pdfCell}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9">لا توجد بيانات</td></tr>`;

  $("all_vendors").innerHTML = rows;

  $("all_prev").disabled = (ALLV_PAGE <= 1);
  $("all_next").disabled = (ALLV_PAGE >= pages);
}

/* -------------------------------------------------------------- */

function wire(){
  $("vendor").addEventListener("input", render);
  $("status").addEventListener("input", render);
  $("date_from_txt").addEventListener("input", render);
  $("date_to_txt").addEventListener("input", render);

  $("clearFilters").addEventListener("click", ()=>{
    $("vendor").value = "";
    $("status").value = "";
    $("date_from_txt").value = "";
    $("date_to_txt").value = "";
    render();
  });

  document.querySelectorAll("[data-popup]").forEach(el=>{
    el.addEventListener("click", ()=>{
      const type = el.getAttribute("data-popup");
      popupFor(type);
    });
  });

  // All Vendors controls
  $("all_search")?.addEventListener("input", ()=>{
    applyAllVendorsSearch();
    renderAllVendors();
  });
  $("all_prev")?.addEventListener("click", ()=>{
    ALLV_PAGE = Math.max(1, ALLV_PAGE - 1);
    renderAllVendors();
  });
  $("all_next")?.addEventListener("click", ()=>{
    ALLV_PAGE = ALLV_PAGE + 1;
    renderAllVendors();
  });
}

async function init(){
  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if (!res.ok){
    alert("مش قادر أقرأ الداتا من المصدر (CSV).");
    return;
  }

  const text = await res.text();

  RAW = parseCSV(text)
    .map(mapRow)
    .filter(isScheduledPayable);

  GROUPS_ALL = group(RAW);

  // Vendors datalist
  const vendorList = Array.from(new Set(GROUPS_ALL.map(g=>g.vendor))).sort((a,b)=>a.localeCompare(b));
  $("vendorsList").innerHTML = vendorList.map(v=>`<option value="${escHtml(v)}"></option>`).join("");

  // ✅ Build All Vendors (Unique) from RAW
  ALLV = buildAllVendorsFromRaw(RAW);
  ALLV_FILTERED = ALLV.slice();
  ALLV_PAGE = 1;

  wire();
  render();
  renderAllVendors();
}

function render(){
  const shownGroups = filteredGroups();
  renderKPIs(shownGroups);
  renderBuckets(shownGroups);
  renderTopVendors(shownGroups);
  renderTable(shownGroups);
  renderMeta(GROUPS_ALL, shownGroups);
}

init();
