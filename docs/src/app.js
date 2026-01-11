import { HEADER_MAP } from "./schema.js";

let data = [];

// ============================
// Utils
// ============================
function toNumber(x) {
  const s = String(x ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  return (n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function parseDateSmart(s) {
  const t = String(s ?? "").trim();
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

    // نحاول نفهمها بذكاء:
    // لو أول رقم > 12 يبقى غالباً D/M/YYYY
    let mm = a, dd = b;
    if (a > 12) { dd = a; mm = b; }

    const d = new Date(Date.UTC(y, mm - 1, dd));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}


function normalizeVendor(v) {
  const t = String(v ?? "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim();

  if (!t) return "";
  const lower = t.toLowerCase();
  if (t === "-" || t === "0" || lower === "null" || lower === "none") return "";

  return t;
}

function normalizeHeaderKey(h) {
  return String(h ?? "")
    .replace(/\ufeff/g, "")    // BOM
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================
// CSV
// ============================
function parseCSV(text) {
  const res = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => normalizeHeaderKey(h), // ✅ critical
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
    const mapped = HEADER_MAP[kNorm] || kNorm; // English passes through
    row[mapped] = value;
  });

  const vendor = normalizeVendor(row.vendor);

  return {
    sector: String(row.sector ?? "").trim(),
    project: String(row.project ?? "").trim(),
    account_item: String(row.account_item ?? "").trim(),
    status: String(row.status ?? "").trim(),

    request_id: String(row.request_id ?? "").trim(),
    code: String(row.code ?? "").trim(),
    vendor,

    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
    amount_canceled: toNumber(row.amount_canceled),
    amount_remaining: toNumber(row.amount_remaining),

    source_request_date: String(row.source_request_date ?? "").trim(),
    payment_request_date: String(row.payment_request_date ?? "").trim(),
    approval_date: String(row.approval_date ?? "").trim(),
    payment_date: String(row.payment_date ?? "").trim(),

    _srcDate: parseDateSmart(row.source_request_date),
    _payReqDate: parseDateSmart(row.payment_request_date),

  };
}

// ============================
// Rules / Filters
// ============================
function applyFilters(rows) {
  // ✅ Official row rule: vendor must exist
  return rows.filter((r) => !!r.vendor);
}

// ============================
// Data Quality
// ============================
function computeDataQuality(allRows) {
  let excludedVendor = 0;
  let missingProject = 0;
  let badDates = 0;

  allRows.forEach((r) => {
    if (!r.vendor) excludedVendor++;
    if (!r.project) missingProject++;

    if (
      (r.source_request_date && !r._srcDate) ||
      (r.payment_request_date && !r._payReqDate)
    ) {
      badDates++;
    }
  });

  return { total: allRows.length, excludedVendor, missingProject, badDates };
}

// ============================
// Render
// ============================
function render() {
  // Data Quality (all rows)
  const dq = computeDataQuality(data);
  const elTotal = document.getElementById("dq_total");
  if (elTotal) {
    document.getElementById("dq_total").textContent = dq.total;
    document.getElementById("dq_excluded_vendor").textContent = dq.excludedVendor;
    document.getElementById("dq_missing_project").textContent = dq.missingProject;
    document.getElementById("dq_bad_dates").textContent = dq.badDates;
  }

  // Filtered (official rows only)
  const filtered = applyFilters(data);

  document.getElementById("kpi_total").textContent =
    fmtMoney(filtered.reduce((a, x) => a + x.amount_total, 0));

  document.getElementById("kpi_paid").textContent =
    fmtMoney(filtered.reduce((a, x) => a + x.amount_paid, 0));

  document.getElementById("kpi_remaining").textContent =
    fmtMoney(filtered.reduce((a, x) => a + x.amount_remaining, 0));

  document.getElementById("kpi_count").textContent =
    `عدد المطالبات: ${filtered.length}`;

  document.getElementById("kpi_paid_count").textContent =
    `عدد السجلات: ${filtered.length}`;

  document.getElementById("kpi_remaining_count").textContent =
    `عدد السجلات: ${filtered.length}`;

  const tbody = document.getElementById("rows");
  tbody.innerHTML = filtered.map((r) => `
    <tr>
      <td>${r.request_id}</td>
      <td>${r.code}</td>
      <td>${r.vendor}</td>
      <td>${fmtMoney(r.amount_total)}</td>
      <td>${fmtMoney(r.amount_paid)}</td>
      <td>${fmtMoney(r.amount_canceled)}</td>
      <td>${fmtMoney(r.amount_remaining)}</td>
      <td>${r.account_item}</td>
      <td>${r.project}</td>
      <td>${r.source_request_date}</td>
      <td>${r.payment_request_date}</td>
      <td>${r.approval_date}</td>
      <td>${r.payment_date}</td>
    </tr>
  `).join("");
}

  let projectsBySector = new Map();
let allProjects = [];

function uniqSorted(values){
  return Array.from(new Set(values.filter(v => String(v).trim()))).sort((a,b)=> String(a).localeCompare(String(b)));
}

function setSelectOptions(id, values, keepValue=false){
  const sel = document.getElementById(id);
  const current = sel.value;
  const opts = uniqSorted(values);

  sel.innerHTML = `<option value="">الكل</option>` + opts.map(v => `<option value="${String(v)}">${String(v)}</option>`).join("");

  if (keepValue && current && opts.includes(current)) sel.value = current;
  else sel.value = "";
}

function rebuildProjectDropdownForSector(){
  const sector = document.getElementById("sector").value.trim();
  const projects = sector ? Array.from(projectsBySector.get(sector) || []) : allProjects;
  setSelectOptions("project", projects, true);
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

  // build sector -> projects map
projectsBySector = new Map();
data.forEach(r => {
  const sec = (r.sector || "(بدون قطاع)").trim();
  const proj = (r.project || "").trim();
  if (!proj) return;
  if (!projectsBySector.has(sec)) projectsBySector.set(sec, new Set());
  projectsBySector.get(sec).add(proj);
});

allProjects = uniqSorted(data.map(r => r.project));

// dropdowns
setSelectOptions("sector", data.map(r => r.sector));
setSelectOptions("account_item", data.map(r => r.account_item)); // global
setSelectOptions("status", data.map(r => r.status));             // global
setSelectOptions("project", allProjects);

// events
document.getElementById("sector").addEventListener("change", () => {
  rebuildProjectDropdownForSector();
  render();
});

["project","account_item","status","date_type","date_from","date_to"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("change", render);
  el.addEventListener("input", render);
});

document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("sector").value = "";
  rebuildProjectDropdownForSector();
  document.getElementById("account_item").value = "";
  document.getElementById("status").value = "";
  document.getElementById("date_type").value = "source_request_date";
  document.getElementById("date_from").value = "";
  document.getElementById("date_to").value = "";
  render();
});

  
  render();
}

init();
