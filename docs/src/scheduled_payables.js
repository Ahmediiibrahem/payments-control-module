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

  if (/^\d+(\.\d+)?$/.test(s0)) {
    const num = Number(s0);
    if (num > 20000 && num < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30));
      d.setUTCDate(d.getUTCDate() + Math.floor(num));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s0)){
    const d = new Date(s0);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s0);
  if (m){
    const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }

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

function mapRow(raw){
  const mapped = {};
  for (const [k, v] of Object.entries(raw || {})){
    const kk = normalizeHeaderKey(k);
    const m = HEADER_MAP[kk] || kk;
    mapped[m] = v;
  }

  const request_id = String(mapped.request_id ?? "").trim();
  const vendor = String(mapped.vendor ?? "").trim();
  const code = String(mapped.code ?? "").trim();
  const account_item = String(mapped.account_item ?? "").trim();

  const d = parseDateSmart(mapped.source_request_date);
  const amount_total = toNumber(mapped.amount_total);
  const amount_paid = toNumber(mapped.amount_paid);
  const amount_canceled = toNumber(mapped.amount_canceled);

  const gross = Math.max(0, amount_total - amount_canceled);
  const out = Math.max(0, gross - amount_paid);

  return { request_id, vendor, code, account_item, date: d, gross, paid: amount_paid, out };
}

// ---------- State ----------
let RAW = [];
let GROUPS_ALL = [];

function isScheduledPayable(r){
  return normText(r.request_id).includes(normText("مستحقات"));
}

function todayUTC0(){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysBetweenUTC(d, baseUTC0){
  const ms = 24*60*60*1000;
  return Math.ceil((d.getTime() - baseUTC0.getTime()) / ms);
}

// Group by Vendor + source_request_date
function group(rows){
  const m = new Map();
  for (const r of rows){
    if (!r.vendor || !(r.date instanceof Date) || isNaN(r.date.getTime())) continue;

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
    g.gross += r.gross;
    g.paid += r.paid;
    g.out += r.out;
    g.lines.push(r);
  }
  return Array.from(m.values());
}

function setSelectOptions(el, labels){
  const uniq = Array.from(new Set(labels.filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  el.innerHTML = `<option value="">الكل</option>` + uniq.map(x=>`<option value="${escHtml(x)}">${escHtml(x)}</option>`).join("");
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

function renderModal(g){
  $("spModalTitle").textContent = `${g.vendor} — ${g.dateLabel}`;
  $("spModalSub").textContent = `Gross: ${fmtMoney(g.gross)} | Paid: ${fmtMoney(g.paid)} | Outstanding: ${fmtMoney(g.out)}`;

  const rows = g.lines.map((r, i)=>{
    const rem = Math.max(0, r.gross - r.paid);
    return `
      <tr>
        <td>${i+1}</td>
        <td>${escHtml(r.code || "—")}</td>
        <td>${escHtml(r.account_item || "—")}</td>
        <td>${fmtMoney(r.gross)}</td>
        <td>${fmtMoney(r.paid)}</td>
        <td>${fmtMoney(rem)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">لا توجد بيانات</td></tr>`;

  $("spModalRows").innerHTML = rows;
  openModal();
}

function getFilters(){
  const v = $("vendor").value;
  const from = parseDateSmart($("date_from_txt").value);
  const to = parseDateSmart($("date_to_txt").value);
  const showSettled = $("show_settled").checked;

  const fromUTC = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0,0,0)) : null;
  const toUTC = to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23,59,59)) : null;

  return { vKey: normText(v), fromUTC, toUTC, showSettled };
}

function inRange(d, fromUTC, toUTC){
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  if (fromUTC && d.getTime() < fromUTC.getTime()) return false;
  if (toUTC && d.getTime() > toUTC.getTime()) return false;
  return true;
}

function applyFilters(groups){
  const { vKey, fromUTC, toUTC, showSettled } = getFilters();
  return groups.filter(g=>{
    if (vKey && g.vendorKey !== vKey) return false;
    if ((fromUTC || toUTC) && !inRange(g.date, fromUTC, toUTC)) return false;
    if (!showSettled && g.out <= 0) return false;
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

  const buckets = {
    b7:  { amt:0, cnt:0 },
    b14: { amt:0, cnt:0 },
    b30: { amt:0, cnt:0 },
    b30p:{ amt:0, cnt:0 },
  };

  for (const g of groups){
    if (g.out <= 0) continue;

    // Overdue excluded from buckets
    if (g.date.getTime() < t0.getTime()) continue;

    const days = daysBetweenUTC(g.date, t0); // 0 = today
    if (days <= 7) { buckets.b7.amt += g.out; buckets.b7.cnt++; continue; }
    if (days <= 14){ buckets.b14.amt += g.out; buckets.b14.cnt++; continue; }
    if (days <= 30){ buckets.b30.amt += g.out; buckets.b30.cnt++; continue; }
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
    if (!by.has(g.vendorKey)) by.set(g.vendorKey, { vendor:g.vendor, out:0, cnt:0 });
    const x = by.get(g.vendorKey);
    x.out += g.out;
    x.cnt += 1;
  }
  const top = Array.from(by.values()).sort((a,b)=>b.out - a.out).slice(0,5);

  $("top_vendors").innerHTML = top.map((x,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${escHtml(x.vendor)}</td>
      <td>${fmtMoney(x.out)}</td>
      <td>${x.cnt}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">لا توجد بيانات</td></tr>`;
}

function renderTable(groups){
  const t0 = todayUTC0();

  const sorted = groups.slice().sort((a,b)=>{
    const ad = a.date?.getTime() || 0;
    const bd = b.date?.getTime() || 0;
    if (ad !== bd) return ad - bd; // أقدم -> أحدث (لأنها التزامات)
    return (b.out||0) - (a.out||0);
  });

  $("rows").innerHTML = sorted.map(g=>{
    const isOverdue = g.out>0 && g.date.getTime() < t0.getTime();
    const isSettled = g.out <= 0;
    const days = daysBetweenUTC(g.date, t0);
    const daysTxt = isSettled ? "—" : (isOverdue ? Math.abs(days) : days);

    const status = isSettled ? "مسدد" : (isOverdue ? "متأخر" : "قادم");

    return `
      <tr class="clickable-row" data-key="${escHtml(g.key)}">
        <td>${g.dateLabel}</td>
        <td>${escHtml(g.vendor)}</td>
        <td>${fmtMoney(g.gross)}</td>
        <td>${fmtMoney(g.paid)}</td>
        <td>${fmtMoney(g.out)}</td>
        <td>${status}</td>
        <td>${daysTxt}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">لا توجد بيانات</td></tr>`;

  $("rows").onclick = (e)=>{
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.getAttribute("data-key");
    const g = sorted.find(x=>x.key===key);
    if (g) renderModal(g);
  };
}

function renderMeta(allGroups, shownGroups){
  const totalAll = allGroups.length;
  const totalShown = shownGroups.length;
  $("meta").textContent = `المعروض: ${totalShown} من ${totalAll} | Vendor: ${$("vendor").selectedOptions[0]?.textContent || "الكل"}`;
}

function exportCSV(groups){
  const header = ["date","vendor","gross","paid","outstanding","lines_count"];
  const rows = groups.map(g=>[
    g.dateLabel,
    g.vendor,
    String(Math.round(g.gross||0)),
    String(Math.round(g.paid||0)),
    String(Math.round(g.out||0)),
    String(g.lines.length)
  ]);

  const csv = [header.join(","), ...rows.map(r=>r.map(x=>{
    const s = String(x ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(","))].join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "scheduled_payables.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wire(){
  $("vendor").addEventListener("change", render);
  $("date_from_txt").addEventListener("input", render);
  $("date_to_txt").addEventListener("input", render);
  $("show_settled").addEventListener("change", render);

  $("clearBtn").addEventListener("click", ()=>{
    $("vendor").value = "";
    $("date_from_txt").value = "";
    $("date_to_txt").value = "";
    $("show_settled").checked = false;
    render();
  });

  $("exportBtn").addEventListener("click", ()=>{
    const shown = applyFilters(GROUPS_ALL);
    exportCSV(shown);
  });
}

async function init(){
  const res = await fetch(DATA_SOURCE.cashCsvUrl, { cache:"no-store" });
  if (!res.ok){
    alert("مش قادر أقرأ الداتا من المصدر (CSV).");
    return;
  }

  const text = await res.text();
  RAW = parseCSV(text).map(mapRow).filter(isScheduledPayable);

  GROUPS_ALL = group(RAW);

  const vendorList = Array.from(new Set(GROUPS_ALL.map(g=>g.vendor))).sort((a,b)=>a.localeCompare(b));
  setSelectOptions($("vendor"), vendorList);

  wire();
  render();
}

function render(){
  const shown = applyFilters(GROUPS_ALL);
  renderKPIs(shown);
  renderBuckets(shown);
  renderTopVendors(shown);
  renderTable(shown);
  renderMeta(GROUPS_ALL, shown);
}

init();
