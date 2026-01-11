import { HEADER_MAP } from "./schema.js";

let data = [];

let projectsBySector = new Map();   // sectorKey -> Set(projectKey)
let sectorLabelByKey = new Map();   // sectorKey -> label
let projectLabelByKey = new Map();  // projectKey -> label

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

// Accepts YYYY-MM-DD primarily; also M/D/YYYY (in case)
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

function formatDayKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

  const vendor = normText(row.vendor); // official row rule
  const timeCode = normText(row.time_code || row.Time || row.time); // Time column
  const payReqRaw = normText(row.payment_request_date);
  const payReqDate = parseDateSmart(payReqRaw);
  const dayKey = payReqDate ? formatDayKey(payReqDate) : ""; // ✅ day comes from payment_request_date

  return {
    sectorKey,
    projectKey,
    sector: sectorLabel,
    project: projectLabel,
    vendor,
    time_code: timeCode,
    payment_request_date: payReqRaw,
    day_key: dayKey, // YYYY-MM-DD
  };
}

function uniqSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(id, values, keepValue = false, allLabel = "الكل") {
  const sel = document.getElementById(id);
  const current = sel.value;

  const opts = uniqSorted(values);
  sel.innerHTML =
    `<option value="">${allLabel}</option>` +
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

function applyFilters(rows) {
  const sectorKey = document.getElementById("sector").value;
  const projectLabel = document.getElementById("project").value;
  const projectKey = normText(projectLabel);
  const dayKey = document.getElementById("day_key").value; // YYYY-MM-DD

  return rows.filter(r => {
    if (!r.vendor) return false;        // official
    if (!r.time_code) return false;     // must have Time for unique email
    if (!r.day_key) return false;       // must have payment_request_date valid

    if (sectorKey && r.sectorKey !== sectorKey) return false;
    if (projectKey && r.projectKey !== projectKey) return false;
    if (dayKey && r.day_key !== dayKey) return false;

    return true;
  });
}

// Unique email = unique time_code within sector + project + day_key
function buildUniqueEmails(filteredRows) {
  const seen = new Set();
  const emails = [];

  for (const r of filteredRows) {
    const key = `${r.sectorKey}||${r.projectKey}||${r.day_key}||${r.time_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(r);
  }
  return emails;
}

function renderChart(dayCounts) {
  const chart = document.getElementById("chart");
  chart.innerHTML = "";

  const keys = Object.keys(dayCounts).sort();
  if (!keys.length) {
    chart.innerHTML = `<div class="small">لا توجد بيانات بعد الفلاتر (تأكد أن payment_request_date بصيغة YYYY-MM-DD وأن Time غير فارغ).</div>`;
    return;
  }

  const max = Math.max(...keys.map(k => dayCounts[k]));
  keys.slice(-18).forEach(k => {
    const h = max ? Math.round((dayCounts[k] / max) * 100) : 0;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.max(10, Math.round(160 * (h/100)))}px`;
    bar.title = `${k}: ${dayCounts[k]}`;
    const label = document.createElement("span");
    label.textContent = k;
    bar.appendChild(label);
    chart.appendChild(bar);
  });
}

function render() {
  const filtered = applyFilters(data);
  const uniqueEmails = buildUniqueEmails(filtered);

  const totalEmails = uniqueEmails.length;

  const daysSet = new Set(uniqueEmails.map(x => x.day_key));
  const daysCount = daysSet.size;
  const avg = daysCount ? (totalEmails / daysCount) : 0;

  // Top project
  const byProject = new Map();
  for (const e of uniqueEmails) {
    const k = e.projectKey || "(بدون مشروع)";
    byProject.set(k, (byProject.get(k) || 0) + 1);
  }
  let topProjectKey = "";
  let topProjectCount = 0;
  for (const [k, c] of byProject.entries()) {
    if (c > topProjectCount) { topProjectKey = k; topProjectCount = c; }
  }
  const topProjectLabel = projectLabelByKey.get(topProjectKey) || topProjectKey || "—";

  document.getElementById("kpi_emails").textContent = totalEmails.toLocaleString("en-US");
  document.getElementById("kpi_days").textContent = daysCount.toLocaleString("en-US");
  document.getElementById("kpi_avg").textContent = (Math.round(avg * 10) / 10).toLocaleString("en-US");
  document.getElementById("kpi_top_project").textContent = topProjectLabel || "—";
  document.getElementById("kpi_top_project_hint").textContent = topProjectCount ? `عدد الإيميلات: ${topProjectCount}` : "—";

  // Meta
  const sectorSelText = document.getElementById("sector").selectedOptions[0]?.textContent || "الكل";
  const projectSel = document.getElementById("project").value || "الكل";
  const daySel = document.getElementById("day_key").value || "الكل";
  document.getElementById("meta").textContent =
    `المعروض: ${totalEmails} إيميل | قطاع: ${sectorSelText} | مشروع: ${projectSel} | يوم: ${daySel}`;

  // Counts per day
  const dayCounts = {};
  for (const e of uniqueEmails) {
    dayCounts[e.day_key] = (dayCounts[e.day_key] || 0) + 1;
  }
  renderChart(dayCounts);

  // Summary table
  const summaryMap = new Map(); // day||sector||project -> count
  for (const e of uniqueEmails) {
    const key = `${e.day_key}||${e.sectorKey}||${e.projectKey}`;
    summaryMap.set(key, (summaryMap.get(key) || 0) + 1);
  }

  const summaryRows = Array.from(summaryMap.entries())
    .map(([k, count]) => {
      const [dayKey, sKey, pKey] = k.split("||");
      return {
        dayKey,
        sector: sectorLabelByKey.get(sKey) || sKey,
        project: projectLabelByKey.get(pKey) || pKey,
        count
      };
    })
    .sort((a, b) => (a.dayKey.localeCompare(b.dayKey)) || (b.count - a.count));

  document.getElementById("summary_rows").innerHTML = summaryRows.map(r => `
    <tr>
      <td class="mono">${r.dayKey}</td>
      <td>${r.sector}</td>
      <td>${r.project}</td>
      <td>${r.count}</td>
    </tr>
  `).join("");

  // Detail table (unique emails)
  const details = uniqueEmails
    .slice()
    .sort((a, b) => (a.day_key.localeCompare(b.day_key)) || (a.project.localeCompare(b.project)) || (a.time_code.localeCompare(b.time_code)));

  document.getElementById("detail_rows").innerHTML = details.map(r => `
    <tr>
      <td class="mono">${r.day_key}</td>
      <td>${r.sector}</td>
      <td>${r.project}</td>
      <td class="mono">${r.time_code}</td>
    </tr>
  `).join("");
}

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

  // dropdowns
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = document.getElementById("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // day dropdown from payment_request_date (YYYY-MM-DD)
  setSelectOptions("day_key", data.map(r => r.day_key).filter(Boolean), false, "الكل");

  // events
  document.getElementById("sector").addEventListener("change", () => {
    rebuildProjectDropdownForSector();
    render();
  });

  ["project","day_key"].forEach(id => {
    document.getElementById(id).addEventListener("change", render);
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("sector").value = "";
    rebuildProjectDropdownForSector();
    document.getElementById("day_key").value = "";
    render();
  });

  // export unique emails list
  document.getElementById("exportBtn").addEventListener("click", () => {
    const filtered = applyFilters(data);
    const uniqueEmails = buildUniqueEmails(filtered);

    const headers = ["day_key","sector","project","time_code","payment_request_date"];
    const safe = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
    };

    const lines = [headers.join(",")];
    uniqueEmails.forEach(r => {
      lines.push([
        safe(r.day_key),
        safe(r.sector),
        safe(r.project),
        safe(r.time_code),
        safe(r.payment_request_date),
      ].join(","));
    });

    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "email_uploads_unique.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  render();
}

init();
