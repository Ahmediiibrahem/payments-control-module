import { HEADER_MAP } from "./schema.js";

let data = [];

let projectsBySector = new Map();  // sectorKey -> Set(projectKey)
let sectorLabelByKey = new Map();  // sectorKey -> label
let projectLabelByKey = new Map(); // projectKey -> label

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
    let mm = a, dd = b;
    if (a > 12) { dd = a; mm = b; }
    const d = new Date(Date.UTC(y, mm - 1, dd));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
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
// Normalize Row
// ============================
function normalizeRow(raw) {
  const row = {};

  Object.entries(raw).forEach(([key, value]) => {
    const kNorm = normalizeHeaderKey(key);
    const mapped = HEADER_MAP[kNorm] || kNorm; // English passes through
    row[mapped] = value;
  });

  const sectorLabel = normText(row.sector) || "(بدون قطاع)";
  const projectLabel = normText(row.project);
  const accountItem = normText(row.account_item);
  const status = normText(row.status);

  const requestId = normText(row.request_id);
  const code = normText(row.code);
  const vendor = normalizeVendor(row.vendor);

  const sectorKey = normText(sectorLabel);
  const projectKey = normText(projectLabel);

  if (sectorKey) sectorLabelByKey.set(sectorKey, sectorLabel);
  if (projectKey) projectLabelByKey.set(projectKey, projectLabel);

  return {
    sectorKey,
    projectKey,

    sector: sectorLabel,
    project: projectLabel,
    account_item: accountItem,
    status,

    request_id: requestId,
    code,
    vendor,

    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
    amount_canceled: toNumber(row.amount_canceled),
    amount_remaining: toNumber(row.amount_remaining),

    source_request_date: normText(row.source_request_date),
    payment_request_date: normText(row.payment_request_date),
    approval_date: normText(row.approval_date),
    payment_date: normText(row.payment_date),

    _srcDate: parseDateSmart(row.source_request_date),
    _payReqDate: parseDateSmart(row.payment_request_date),
  };
}

// ============================
// Dropdown Helpers
// ============================
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
// Filters
// ============================
function getFilterDates() {
  const fromStr = document.getElementById("date_from").value;
  const toStr = document.getElementById("date_to").value;

  const from = fromStr ? parseDateSmart(fromStr) : null;
  const toRaw = toStr ? parseDateSmart(toStr) : null;
  const to = toRaw ? new Date(toRaw.getTime() + (24 * 60 * 60 * 1000) - 1) : null;

  return { from, to };
}

function applyFilters(rows, { ignoreStatus = false } = {}) {
  const sectorKey = document.getElementById("sector").value;
  const projectLabel = document.getElementById("project").value;
  const projectKey = normText(projectLabel);

  const accountItemLabel = document.getElementById("account_item").value;
  const accountItemKey = normText(accountItemLabel);

  const statusValue = document.getElementById("status").value; // "", "Paid", "Pending"

  const dateType = document.getElementById("date_type").value;
  const { from, to } = getFilterDates();

  return rows.filter(r => {
    // Official row rule
    if (!r.vendor) return false;

    if (sectorKey && r.sectorKey !== sectorKey) return false;
    if (projectKey && r.projectKey !== projectKey) return false;
    if (accountItemKey && normText(r.account_item) !== accountItemKey) return false;

    // Date filter
    if (from || to) {
      const d = (dateType === "payment_request_date") ? r._payReqDate : r._srcDate;
      if (!d) return false;
      if (from && d.getTime() < from.getTime()) return false;
      if (to && d.getTime() > to.getTime()) return false;
    }

    // Status filter affects table only
    if (!ignoreStatus) {
      if (statusValue === "Paid") {
        if (!(r.amount_remaining === 0 && r.amount_paid > 0)) return false;
      }
      if (statusValue === "Pending") {
        if (!(r.amount_remaining > 0)) return false;
      }
    }

    return true;
  });
}

// ============================
// Data Quality
// ============================
function computeDataQuality(allRows) {
  let excludedVendor = 0;
  let missingProject = 0;
  let badDates = 0;

  allRows.forEach(r => {
    if (!r.vendor) excludedVendor++;
    if (!r.project) missingProject++;

    if (
      (r.source_request_date && !r._srcDate) ||
      (r.payment_request_date && !r._payReqDate)
    ) badDates++;
  });

  return { total: allRows.length, excludedVendor, missingProject, badDates };
}

// ============================
// Render
// ============================
function render() {
  // Quality (all rows)
  const dq = computeDataQuality(data);
  document.getElementById("dq_total").textContent = dq.total;
  document.getElementById("dq_excluded_vendor").textContent = dq.excludedVendor;
  document.getElementById("dq_missing_project").textContent = dq.missingProject;
  document.getElementById("dq_bad_dates").textContent = dq.badDates;

  // Base filtered (without status) -> KPIs
  const baseFiltered = applyFilters(data, { ignoreStatus: true });

  // Table filtered (with status) -> Table
  const tableFiltered = applyFilters(data, { ignoreStatus: false });

  // KPIs
  const total = baseFiltered.reduce((a, x) => a + x.amount_total, 0);
  const paid = baseFiltered.reduce((a, x) => a + x.amount_paid, 0);
  const pending = baseFiltered.reduce((a, x) => a + x.amount_remaining, 0);
  const canceled = baseFiltered.reduce((a, x) => a + x.amount_canceled, 0);

  document.getElementById("kpi_total").textContent = fmtMoney(total);
  document.getElementById("kpi_paid").textContent = fmtMoney(paid);
  document.getElementById("kpi_pending").textContent = fmtMoney(pending);
  document.getElementById("kpi_canceled").textContent = fmtMoney(canceled);

  document.getElementById("kpi_count").textContent = `عدد المطالبات: ${baseFiltered.length}`;
  document.getElementById("kpi_paid_count").textContent = `عدد السجلات: ${baseFiltered.length}`;
  document.getElementById("kpi_pending_count").textContent = `عدد السجلات: ${baseFiltered.length}`;
  document.getElementById("kpi_canceled_count").textContent = `عدد السجلات: ${baseFiltered.length}`;

  // Meta
  const sectorSelText = document.getElementById("sector").selectedOptions[0]?.textContent || "الكل";
  const projectSel = document.getElementById("project").value || "الكل";
  const accSel = document.getElementById("account_item").value || "الكل";
  const st = document.getElementById("status").value;
  const stLabel = st === "" ? "All" : st;

  document.getElementById("meta").textContent =
    `المعروض: ${tableFiltered.length} | قطاع: ${sectorSelText} | مشروع: ${projectSel} | بند: ${accSel} | حالة: ${stLabel}`;

  // Table
  const tbody = document.getElementById("rows");
  tbody.innerHTML = tableFiltered.map(r => `
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

  // Build sector -> projects mapping
  projectsBySector = new Map();
  data.forEach(r => {
    if (!r.projectKey) return;
    if (!projectsBySector.has(r.sectorKey)) projectsBySector.set(r.sectorKey, new Set());
    projectsBySector.get(r.sectorKey).add(r.projectKey);
  });

  // Sector dropdown stores sectorKey, displays label
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = document.getElementById("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  // Project dropdown initially all projects
  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // Account item dropdown (global)
  setSelectOptions("account_item", data.map(r => r.account_item));

  // Status dropdown fixed
  const statusSel = document.getElementById("status");
  statusSel.innerHTML = `
    <option value="">All</option>
    <option value="Paid">Paid</option>
    <option value="Pending">Pending</option>
  `;

  // Events
  document.getElementById("sector").addEventListener("change", () => {
    rebuildProjectDropdownForSector();
    render();
  });

  ["project", "account_item", "status", "date_type", "date_from", "date_to"].forEach(id => {
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

  // Export CSV (current table view)
  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const tableFiltered = applyFilters(data, { ignoreStatus: false });

      const headers = [
        "sector","project","account_item",
        "request_id","code","vendor",
        "amount_total","amount_paid","amount_canceled","amount_remaining",
        "source_request_date","payment_request_date","approval_date","payment_date"
      ];

      const safe = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
      };

      const lines = [headers.join(",")];
      tableFiltered.forEach(r => {
        lines.push([
          safe(r.sector),
          safe(r.project),
          safe(r.account_item),
          safe(r.request_id),
          safe(r.code),
          safe(r.vendor),
          r.amount_total,
          r.amount_paid,
          r.amount_canceled,
          r.amount_remaining,
          safe(r.source_request_date),
          safe(r.payment_request_date),
          safe(r.approval_date),
          safe(r.payment_date)
        ].join(","));
      });

      const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "export_filtered.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  render();
}

init();
