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

function toNumber(x) {
  const s = normText(x);
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  return (n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
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

function parseDateSmart(s) {
  const t = normText(s);
  if (!t || t === "-" || t === "0") return null;

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // fallback M/D/YYYY or D/M/YYYY
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

function formatDayKeyISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(iso) {
  // iso: YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const dd = m[3];
  const mon = new Intl.DateTimeFormat("en", { month: "short" }).format(d); // MMM
  return `${Number(dd)}-${mon}`;
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

  const vendor = normText(row.vendor);
  const timeCode = normText(row.time_code || row.Time || row.time);

  const payReqRaw = normText(row.payment_request_date);
  const payReqDate = parseDateSmart(payReqRaw);
  const dayKey = payReqDate ? formatDayKeyISO(payReqDate) : "";

  return {
    sectorKey,
    projectKey,
    sector: sectorLabel,
    project: projectLabel,
    vendor,
    time_code: timeCode,
    payment_request_date: payReqRaw,
    day_key: dayKey,

    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
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

  const projectSel = document.getElementById("project");
  const current = projectSel.value;
  const opts = uniqSorted(projects);

  projectSel.innerHTML =
    `<option value="">الكل</option>` +
    opts.map(v => `<option value="${v}">${v}</option>`).join("");

  if (current && opts.includes(current)) projectSel.value = current;
  else projectSel.value = "";
}

function buildDayDatalist(allDayKeys) {
  const list = document.getElementById("day_list");
  const unique = uniqSorted(allDayKeys);
  list.innerHTML = unique
    .map(iso => `<option value="${formatDayLabel(iso)}"></option>`)
    .join("");
}

// Convert input label like "31-May" back to ISO dayKey if possible.
// We'll map labels->iso.
let dayLabelToISO = new Map();
function rebuildDayLabelMap(dayKeys) {
  dayLabelToISO = new Map();
  dayKeys.forEach(iso => {
    dayLabelToISO.set(formatDayLabel(iso), iso);
  });
}

function getSelectedDayISO() {
  const v = normText(document.getElementById("day_key").value);
  if (!v) return "";
  // user might paste ISO directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return dayLabelToISO.get(v) || "";
}

function applyFilters(rows) {
  const sectorKey = document.getElementById("sector").value;
  const projectLabel = document.getElementById("project").value;
  const projectKey = normText(projectLabel);

  const selectedDayISO = getSelectedDayISO(); // ISO

  return rows.filter(r => {
    if (!r.vendor) return false;
    if (!r.time_code) return false;
    if (!r.day_key) return false;

    if (sectorKey && r.sectorKey !== sectorKey) return false;
    if (projectKey && r.projectKey !== projectKey) return false;
    if (selectedDayISO && r.day_key !== selectedDayISO) return false;

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

function computeDayAggregates(filteredRows) {
  // day_key -> { totalAmount, paidAmount, emailCount }
  const dayAgg = new Map();

  // For emailCount we need distinct Time per day (within current filters)
  const dayEmailSeen = new Map(); // day_key -> Set(time_code)

  for (const r of filteredRows) {
    if (!dayAgg.has(r.day_key)) {
      dayAgg.set(r.day_key, { totalAmount: 0, paidAmount: 0, emailCount: 0 });
      dayEmailSeen.set(r.day_key, new Set());
    }
    const agg = dayAgg.get(r.day_key);
    agg.totalAmount += r.amount_total;
    agg.paidAmount += r.amount_paid;

    const set = dayEmailSeen.get(r.day_key);
    if (!set.has(r.time_code)) {
      set.add(r.time_code);
      agg.emailCount += 1;
    }
  }

  return dayAgg;
}

function renderChart(dayAgg, selectedDayISO) {
  const chart = document.getElementById("chart");
  chart.innerHTML = "";

  const days = Array.from(dayAgg.keys()).sort(); // ISO ascending
  if (!days.length) {
    chart.innerHTML = `<div class="small">لا توجد بيانات بعد الفلاتر (تأكد أن payment_request_date بصيغة YYYY-MM-DD وأن Time غير فارغ).</div>`;
    document.getElementById("chart_hint").textContent = "—";
    document.getElementById("selected_day_stats").textContent = "—";
    return;
  }

  // If a day is selected, show window ending at that day. Otherwise last 15 days available.
  let windowDays = days.slice(-15);
  if (selectedDayISO) {
    const idx = days.indexOf(selectedDayISO);
    if (idx >= 0) {
      windowDays = days.slice(Math.max(0, idx - 14), idx + 1);
    } else {
      windowDays = days.slice(-15);
    }
  }

  const maxVal = Math.max(...windowDays.map(d => dayAgg.get(d).totalAmount || 0), 1);

  windowDays.forEach(d => {
    const val = dayAgg.get(d).totalAmount || 0;
    const h = Math.max(10, Math.round(170 * (val / maxVal)));

    const bar = document.createElement("div");
    bar.className = "bar" + (selectedDayISO && d === selectedDayISO ? " active" : "");
    bar.style.height = `${h}px`;
    bar.title = `${d} | قيمة: ${fmtMoney(val)} | عدد: ${dayAgg.get(d).emailCount}`;

    const label = document.createElement("span");
    label.textContent = formatDayLabel(d); // 31-May
    bar.appendChild(label);

    chart.appendChild(bar);
  });

  const from = windowDays[0];
  const to = windowDays[windowDays.length - 1];
  document.getElementById("chart_hint").innerHTML =
    `النطاق: <b>${formatDayLabel(from)}</b> → <b>${formatDayLabel(to)}</b> (آخر 15 يوم)`;

  if (selectedDayISO && dayAgg.has(selectedDayISO)) {
    const a = dayAgg.get(selectedDayISO);
    document.getElementById("selected_day_stats").innerHTML =
      `اليوم المختار: <b>${formatDayLabel(selectedDayISO)}</b> | عدد: <b>${a.emailCount}</b> | قيمة: <b>${fmtMoney(a.totalAmount)}</b>`;
  } else {
    document.getElementById("selected_day_stats").textContent = "—";
  }
}

function render() {
  const filtered = applyFilters(data);
  const uniqueEmails = buildUniqueEmails(filtered);

  // KPI: total emails
  document.getElementById("kpi_emails").textContent = uniqueEmails.length.toLocaleString("en-US");

  // KPI: totals based on rows with Time (already filtered)
  const totalAmount = filtered.reduce((a, x) => a + x.amount_total, 0);
  const paidAmount = filtered.reduce((a, x) => a + x.amount_paid, 0);

  document.getElementById("kpi_total_amount").textContent = fmtMoney(totalAmount);
  document.getElementById("kpi_paid_amount").textContent = fmtMoney(paidAmount);

  // Top projects:
  // (A) by email count (distinct Time)
  const emailSetByProject = new Map(); // projectKey -> Set(time_code)
  // (B) by paid amount
  const paidByProject = new Map(); // projectKey -> sum(amount_paid)

  for (const r of filtered) {
    const pk = r.projectKey || "(بدون مشروع)";

    if (!emailSetByProject.has(pk)) emailSetByProject.set(pk, new Set());
    emailSetByProject.get(pk).add(r.time_code);

    paidByProject.set(pk, (paidByProject.get(pk) || 0) + r.amount_paid);
  }

  let topCountProjectKey = "";
  let topCount = -1;
  for (const [pk, set] of emailSetByProject.entries()) {
    if (set.size > topCount) {
      topCount = set.size;
      topCountProjectKey = pk;
    }
  }

  let topPaidProjectKey = "";
  let topPaid = -1;
  for (const [pk, sum] of paidByProject.entries()) {
    if (sum > topPaid) {
      topPaid = sum;
      topPaidProjectKey = pk;
    }
  }

  document.getElementById("kpi_top_count_project").textContent =
    projectLabelByKey.get(topCountProjectKey) || topCountProjectKey || "—";
  document.getElementById("kpi_top_count_value").textContent =
    topCount >= 0 ? `${topCount.toLocaleString("en-US")} ايميل` : "—";

  document.getElementById("kpi_top_paid_project").textContent =
    projectLabelByKey.get(topPaidProjectKey) || topPaidProjectKey || "—";
  document.getElementById("kpi_top_paid_value").textContent =
    topPaid >= 0 ? `${fmtMoney(topPaid)}` : "—";

  // Meta
  const sectorSelText = document.getElementById("sector").selectedOptions[0]?.textContent || "الكل";
  const projectSel = document.getElementById("project").value || "الكل";
  const selectedDayISO = getSelectedDayISO();
  const dayLabel = selectedDayISO ? formatDayLabel(selectedDayISO) : "الكل";

  document.getElementById("meta").textContent =
    `المعروض: ${uniqueEmails.length} ايميل | قطاع: ${sectorSelText} | مشروع: ${projectSel} | يوم: ${dayLabel}`;

  // Aggregates per day (chart by value)
  const dayAgg = computeDayAggregates(filtered);
  renderChart(dayAgg, selectedDayISO);

  // Summary table: day + sector + project
  // Count distinct Time, sum total + sum paid
  const summaryMap = new Map(); // day||sector||project -> {set,count,total,paid}
  for (const r of filtered) {
    const key = `${r.day_key}||${r.sectorKey}||${r.projectKey}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, { times: new Set(), total: 0, paid: 0 });
    }
    const obj = summaryMap.get(key);
    obj.times.add(r.time_code);
    obj.total += r.amount_total;
    obj.paid += r.amount_paid;
  }

  const summaryRows = Array.from(summaryMap.entries())
    .map(([k, v]) => {
      const [dayKey, sKey, pKey] = k.split("||");
      return {
        dayKey,
        sector: sectorLabelByKey.get(sKey) || sKey,
        project: projectLabelByKey.get(pKey) || pKey,
        emailCount: v.times.size,
        total: v.total,
        paid: v.paid,
      };
    })
    .sort((a, b) => (a.dayKey.localeCompare(b.dayKey)) || (b.total - a.total));

  document.getElementById("summary_rows").innerHTML = summaryRows.map(r => `
    <tr>
      <td class="mono">${formatDayLabel(r.dayKey)}</td>
      <td>${r.sector}</td>
      <td>${r.project}</td>
      <td>${r.emailCount}</td>
      <td>${fmtMoney(r.total)}</td>
      <td>${fmtMoney(r.paid)}</td>
    </tr>
  `).join("");

  // Detail table: list unique emails with totals per email
  // Build email key aggregates: day||sector||project||time
  const emailMap = new Map();
  for (const r of filtered) {
    const k = `${r.day_key}||${r.sectorKey}||${r.projectKey}||${r.time_code}`;
    if (!emailMap.has(k)) emailMap.set(k, { total: 0, paid: 0, sample: r });
    const obj = emailMap.get(k);
    obj.total += r.amount_total;
    obj.paid += r.amount_paid;
  }

  const details = Array.from(emailMap.values())
    .map(x => ({
      dayKey: x.sample.day_key,
      sector: x.sample.sector,
      project: x.sample.project,
      time: x.sample.time_code,
      total: x.total,
      paid: x.paid
    }))
    .sort((a, b) => (a.dayKey.localeCompare(b.dayKey)) || (a.project.localeCompare(b.project)) || (a.time.localeCompare(b.time)));

  document.getElementById("detail_rows").innerHTML = details.map(r => `
    <tr>
      <td class="mono">${formatDayLabel(r.dayKey)}</td>
      <td>${r.sector}</td>
      <td>${r.project}</td>
      <td class="mono">${r.time}</td>
      <td>${fmtMoney(r.total)}</td>
      <td>${fmtMoney(r.paid)}</td>
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

  // dropdown: sector
  const sectorKeys = uniqSorted(Array.from(sectorLabelByKey.keys()));
  const sectorSel = document.getElementById("sector");
  sectorSel.innerHTML =
    `<option value="">الكل</option>` +
    sectorKeys.map(sk => `<option value="${sk}">${sectorLabelByKey.get(sk) || sk}</option>`).join("");

  // dropdown: project (all)
  setSelectOptions("project", Array.from(projectLabelByKey.values()));

  // day datalist from all valid day_keys
  const allDayKeys = uniqSorted(data.map(r => r.day_key).filter(Boolean));
  rebuildDayLabelMap(allDayKeys);
  buildDayDatalist(allDayKeys);

  // events
  document.getElementById("sector").addEventListener("change", () => {
    rebuildProjectDropdownForSector();
    render();
  });

  document.getElementById("project").addEventListener("change", render);

  // day input search
  document.getElementById("day_key").addEventListener("input", render);
  document.getElementById("day_key").addEventListener("change", render);

  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("sector").value = "";
    rebuildProjectDropdownForSector();
    document.getElementById("day_key").value = "";
    render();
  });

  render();
}

init();
