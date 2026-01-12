import { HEADER_MAP } from "./schema.js";

let data = [];

let projectsBySector = new Map();
let sectorLabelByKey = new Map();
let projectLabelByKey = new Map();

let dayLabelToISO = new Map();

let emailDetailsMap = new Map(); // Time -> rows (filtered)

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

function normalizeHeaderKey(h) {
  return String(h ?? "")
    .replace(/\ufeff/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
// CSV
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

function normalizeRow(raw) {
  const row = {};
  let timeFromRaw = "";

  Object.entries(raw).forEach(([key, value]) => {
    const kNorm = normalizeHeaderKey(key);
    const mapped = HEADER_MAP[kNorm] || kNorm;
    row[mapped] = value;

    const kLower = kNorm.toLowerCase();
    if (kLower === "time" || kLower === "mail_time" || kLower === "email_time" || kNorm === "التايم" || kNorm === "الوقت") {
      timeFromRaw = value;
    }
  });

  const sectorLabel = normText(row.sector) || "(بدون قطاع)";
  const projectLabel = normText(row.project);

  const sectorKey = normText(sectorLabel);
  const projectKey = normText(projectLabel);

  if (sectorKey) sectorLabelByKey.set(sectorKey, sectorLabel);
  if (projectKey) projectLabelByKey.set(projectKey, projectLabel);

  const payReqDateStr = normText(row.payment_request_date);
  const payReqDate = parseDateSmart(payReqDateStr);

  const timeValue = normText(row.Time ?? row.time ?? row.TIME ?? timeFromRaw ?? "");

  return {
    sectorKey,
    projectKey,
    sector: sectorLabel,
    project: projectLabel,

    // needed for modal
    code: normText(row.code),
    vendor: normText(row.vendor),
    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
    amount_remaining: toNumber(row.amount_remaining),

    payment_request_date: payReqDateStr,
    _payReqDate: payReqDate,

    Time: timeValue,
  };
}

// ============================
// Date label helpers
// ============================
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toISODateUTC(d){
  if(!d) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function labelFromISO(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||"").trim());
  if(!m) return "—";
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return `${dd}-${MONTHS[mm-1] || "??"}`;
}

// ============================
// Day list
// ============================
function buildDayListOptions(emailRows) {
  const dayISOs = uniqSorted(
    emailRows
      .map(r => toISODateUTC(r._payReqDate))
      .filter(Boolean)
  );

  dayLabelToISO = new Map();
  const dl = document.getElementById("day_list");
  dl.innerHTML = "";

  dayISOs.forEach(iso => {
    const label = labelFromISO(iso);
    dayLabelToISO.set(label, iso);

    const opt = document.createElement("option");
    opt.value = label;
    dl.appendChild(opt);
  });
}

function getSelectedDayISO() {
  const val = normText(document.getElementById("day_key")?.value);
  if (!val) return "";
  if (dayLabelToISO.has(val)) return dayLabelToISO.get(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return "";
}

// ============================
// Filters (Emails page)
// ============================
function applyFiltersEmails(rows) {
  const sectorKey = document.getElementById("sector").value;
  const projectLabel = document.getElementById("project").value;
  const projectKey = normText(projectLabel);
  const selectedDayISO = getSelectedDayISO();

  return rows.filter(r => {
    if (!r.Time) return false;

    if (sectorKey && r.sectorKey !== sectorKey) return false;
    if (projectKey && r.projectKey !== projectKey) return false;

    if (selectedDayISO) {
      const iso = toISODateUTC(r._payReqDate);
      if (iso !== selectedDayISO) return false;
    }
    return true;
  });
}

// ============================
// Aggregations
// ============================
function uniqueEmailCount(rows) {
  return new Set(rows.map(r => r.Time).filter(Boolean)).size;
}

function sumBy(rows, key) {
  return rows.reduce((a, x) => a + (x[key] || 0), 0);
}

function topProjectByEmailCount(rows) {
  const map = new Map();
  rows.forEach(r => {
    const p = r.project || "(بدون مشروع)";
    if (!map.has(p)) map.set(p, new Set());
    map.get(p).add(r.Time);
  });

  let bestProject = "—";
  let bestCount = 0;
  map.forEach((set, project) => {
    if (set.size > bestCount) {
      bestCount = set.size;
      bestProject = project;
    }
  });
  return { project: bestProject, count: bestCount };
}

function topProjectByPaidValue(rows) {
  const map = new Map();
  rows.forEach(r => {
    const p = r.project || "(بدون مشروع)";
    map.set(p, (map.get(p) || 0) + (r.amount_paid || 0));
  });

  let bestProject = "—";
  let bestVal = 0;
  map.forEach((v, project) => {
    if (v > bestVal) {
      bestVal = v;
      bestProject = project;
    }
  });
  return { project: bestProject, paid: bestVal };
}

function groupDailyTotals(rows) {
  const map = new Map();
  rows.forEach(r => {
    const d = r._payReqDate;
    if (!d) return;

    const iso = toISODateUTC(d);
    if (!map.has(iso)) {
      map.set(iso, { iso, label: labelFromISO(iso), total: 0, paid: 0, emails: new Set() });
    }
    const o = map.get(iso);
    o.total += (r.amount_total || 0);
    o.paid  += (r.amount_paid  || 0);
    o.emails.add(r.Time);
  });

  return Array.from(map.values()).sort((a, b) => a.iso.localeCompare(b.iso));
}

function groupSummaryByDaySectorProject(rows) {
  const map = new Map();
  rows.forEach(r => {
    const iso = toISODateUTC(r._payReqDate) || "—";
    const key = `${iso}||${r.sector}||${r.project}`;

    if (!map.has(key)) {
      map.set(key, {
        iso,
        dayLabel: iso === "—" ? "—" : labelFromISO(iso),
        sector: r.sector || "—",
        project: r.project || "—",
        total: 0,
        paid: 0,
        emails: new Set(),
      });
    }

    const o = map.get(key);
    o.total += (r.amount_total || 0);
    o.paid  += (r.amount_paid  || 0);
    o.emails.add(r.Time);
  });

  const out = Array.from(map.values());
  out.sort((a, b) => (b.iso || "").localeCompare(a.iso || "") || a.project.localeCompare(b.project)); // newest first
  return out;
}

function buildEmailDetailsMap(rows) {
  const map = new Map(); // Time -> rows
  rows.forEach(r => {
    if (!r.Time) return;
    if (!map.has(r.Time)) map.set(r.Time, []);
    map.get(r.Time).push(r);
  });
  // Optional: sort inside each email by vendor/code for nice popup
  map.forEach(arr => {
    arr.sort((a,b) => (a.vendor||"").localeCompare(b.vendor||"") || (a.code||"").localeCompare(b.code||""));
  });
  return map;
}

function groupByEmailTime(rows) {
  const map = new Map();
  rows.forEach(r => {
    const t = r.Time;
    if (!t) return;

    if (!map.has(t)) {
      const iso = toISODateUTC(r._payReqDate) || "—";
      map.set(t, {
        iso,
        dayLabel: iso === "—" ? "—" : labelFromISO(iso),
        sector: r.sector || "—",
        project: r.project || "—",
        time: t,
        total: 0,
        paid: 0,
      });
    }

    const o = map.get(t);
    o.total += (r.amount_total || 0);
    o.paid  += (r.amount_paid  || 0);
  });

  const out = Array.from(map.values());

  // ✅ newest -> oldest (date desc), then time desc (string compare ok)
  out.sort((a, b) => (b.iso || "").localeCompare(a.iso || "") || (b.time || "").localeCompare(a.time || ""));

  return out;
}

// ============================
// Chart (STACKED) — unchanged
// ============================
function renderChart(daily, selectedDayISO) {
  const chart = document.getElementById("chart");
  const chartHint = document.getElementById("chart_hint");
  const selectedStats = document.getElementById("selected_day_stats");

  if (chartHint) chartHint.textContent = "";

  if (!daily.length) {
    chart.innerHTML = "";
    if (selectedStats) selectedStats.textContent = "";
    return;
  }

  const last15 = daily.slice(-15);
  const maxTotal = Math.max(...last15.map(d => d.total), 1);

  chart.innerHTML = last15.map(d => {
    const heightPct = Math.round((d.total / maxTotal) * 100);
    const paidPct = d.total > 0 ? Math.round((d.paid / d.total) * 100) : 0;
    const paidHeight = Math.max(0, Math.min(100, paidPct));
    const active = selectedDayISO && d.iso === selectedDayISO;

    return `
      <div class="chart-group">
        <div class="chart-bars">
          <div class="bar-stack ${active ? "active" : ""}" style="height:${heightPct}%">
            <div class="bar-top-value">${fmtMoney(d.total)}</div>
            <div class="bar-paid" style="height:${paidHeight}%">
              <div class="bar-percent">${paidPct}%</div>
            </div>
          </div>
        </div>
        <div class="chart-day">${d.label}</div>
      </div>
    `;
  }).join("");

  if (selectedStats) {
    if (selectedDayISO) {
      const found = daily.find(x => x.iso === selectedDayISO);
      if (found) {
        const pct = found.total > 0 ? Math.round((found.paid / found.total) * 100) : 0;
        selectedStats.innerHTML =
          `اليوم ${found.label} — عدد الإيميلات: <b>${found.emails.size}</b> | إجمالي: <b>${fmtMoney(found.total)}</b> | مصروف: <b>${fmtMoney(found.paid)}</b> | التقدم: <b>${pct}%</b>`;
      } else selectedStats.textContent = "";
    } else {
      selectedStats.innerHTML = `داخل العمود: نسبة الصرف (Paid %) — وفوقه إجمالي طلبات الصرف`;
    }
  }
}

// ============================
// Modal
// ============================
function openModalForEmail(timeKey){
  const modal = document.getElementById("emailModal");
  const closeBtn = document.getElementById("modalClose");
  const title = document.getElementById("modalTitle");
  const sub = document.getElementById("modalSub");
  const tbody = document.getElementById("modalRows");

  const rows = emailDetailsMap.get(timeKey) || [];
  if (!rows.length) return;

  const first = rows[0];
  const sector = first.sector || "—";
  const project = first.project || "—";

  const total = rows.reduce((a,x)=>a+(x.amount_total||0),0);
  const paid  = rows.reduce((a,x)=>a+(x.amount_paid||0),0);

  title.textContent = `${sector} — ${project}`;
  sub.textContent = `إجمالي قيمة الإيميل: ${fmtMoney(total)} | المصروف: ${fmtMoney(paid)} | Time: ${timeKey}`;

  tbody.innerHTML = rows.map((r,idx)=>`
    <tr>
      <td>${idx+1}</td>
      <td>${r.code || "—"}</td>
      <td>${r.vendor || "—"}</td>
      <td>${fmtMoney(r.amount_total)}</td>
      <td>${fmtMoney(r.amount_paid)}</td>
      <td>${fmtMoney(r.amount_remaining)}</td>
    </tr>
  `).join("");

  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");

  const onEsc = (e)=>{ if(e.key==="Escape") close(); };
  const onBackdrop = (e)=>{ if(e.target === modal) close(); };

  function close(){
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    document.removeEventListener("keydown", onEsc);
    modal.removeEventListener("click", onBackdrop);
    closeBtn.removeEventListener("click", close);
  }

  document.addEventListener("keydown", onEsc);
  modal.addEventListener("click", onBackdrop);
  closeBtn.addEventListener("click", close);
}

// ============================
// Render
// ============================
function render() {
  const filtered = applyFiltersEmails(data);

  // keep map for modal (only current filtered view)
  emailDetailsMap = buildEmailDetailsMap(filtered);

  // KPIs
  const emailsCount = uniqueEmailCount(filtered);
  const totalAmount = sumBy(filtered, "amount_total");
  const paidAmount = sumBy(filtered, "amount_paid");

  document.getElementById("kpi_emails").textContent = emailsCount.toLocaleString("en-US");
  document.getElementById("kpi_total_amount").textContent = fmtMoney(totalAmount);
  document.getElementById("kpi_paid_amount").textContent = fmtMoney(paidAmount);

  const topCount = topProjectByEmailCount(filtered);
  const topPaid = topProjectByPaidValue(filtered);

  document.getElementById("kpi_top_count_project").textContent = topCount.project;
  document.getElementById("kpi_top_count_value").textContent = `${topCount.count} Email`;
  document.getElementById("kpi_top_paid_project").textContent = topPaid.project;
  document.getElementById("kpi_top_paid_value").textContent = fmtMoney(topPaid.paid);

  // Meta
  const sectorSelText = document.getElementById("sector").selectedOptions[0]?.textContent || "الكل";
  const projectSel = document.getElementById("project").value || "الكل";
  const dayISO = getSelectedDayISO();
  const dayLabel = dayISO ? labelFromISO(dayISO) : "الكل";

  const meta = document.getElementById("meta");
  if (meta) meta.textContent = `المعروض: ${filtered.length} | قطاع: ${sectorSelText} | مشروع: ${projectSel} | اليوم: ${dayLabel}`;

  // Chart
  const daily = groupDailyTotals(filtered);
  renderChart(daily, dayISO);

  // ✅ DETAILS TABLE (newest first + clickable)
  const detail = groupByEmailTime(filtered);
  const detailBody = document.getElementById("detail_rows");
  detailBody.innerHTML = detail.map(r => `
    <tr class="clickable-row" data-time="${r.time}">
      <td>${r.dayLabel}</td>
      <td>${r.sector}</td>
      <td>${r.project}</td>
      <td class="mono">${r.time}</td>
      <td>${fmtMoney(r.total)}</td>
      <td>${fmtMoney(r.paid)}</td>
    </tr>
  `).join("");

  // bind click
  detailBody.querySelectorAll("tr.clickable-row").forEach(tr => {
    tr.addEventListener("click", () => {
      const t = tr.getAttribute("data-time");
      openModalForEmail(t);
    });
  });

  // SUMMARY TABLE
  const summary = groupSummaryByDaySectorProject(filtered);
  document.getElementById("summary_rows").innerHTML = summary.map(r => `
    <tr>
      <td>${r.dayLabel}</td>
      <td>${r.sector}</td>
      <td>${r.project}</td>
      <td>${r.emails.size}</td>
      <td>${fmtMoney(r.total)}</td>
      <td>${fmtMoney(r.paid)}</td>
    </tr>
  `).join("");
}

// ============================
// Init
// ============================
async function init() {
  const res = await fetch("./data.csv", { cache: "no-store" });
  if (!res.ok) {
    alert("مش قادر أقرأ data.csv — تأكد إنه موجود في docs/");
    return;
  }

  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);

  // sector -> projects
  projectsBySector = new Map();
  data.forEach(r => {
    if (!r.projectKey) return;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = document.getElementById("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // datalist days from rows that have Time + valid date
  const emailRowsAll = data.filter(r => r.Time && r._payReqDate);
  buildDayListOptions(emailRowsAll);

  // Events
  document.getElementById("sector").addEventListener("change", () => {
    rebuildProjectDropdownForSector();
    render();
  });
  document.getElementById("project").addEventListener("change", render);

  const dayKey = document.getElementById("day_key");
  if (dayKey) {
    dayKey.addEventListener("input", render);
    dayKey.addEventListener("change", render);
  }

  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("sector").value = "";
    rebuildProjectDropdownForSector();
    if (dayKey) dayKey.value = "";
    render();
  });

  render();
}

init();
