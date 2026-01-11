import { COLUMNS, HEADER_MAP } from "./schema.js";

let data = [];

function toNumber(x){
  const n = Number(String(x || "").replace(/,/g,""));
  return isNaN(n) ? 0 : n;
}

function fmtMoney(n){
  return (n || 0).toLocaleString("en-US");
}

function parseDateISO(s){
  if(!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Date.UTC(+m[1],+m[2]-1,+m[3])) : null;
}

function normalizeVendor(v){
  const t = String(v||"").replace(/[\u200E\u200F\u202A-\u202E]/g,"").trim();
  if(!t || t==="-" || t==="0" || t.toLowerCase()==="null") return "";
  return t;
}

function parseCSV(text){
  const res = Papa.parse(text,{header:true,skipEmptyLines:true});
  return res.data || [];
}

function normalizeRow(raw){
  const row = {};

  // توحيد أسماء الأعمدة
  Object.entries(raw).forEach(([key,value])=>{
    const k = HEADER_MAP[key] || key;
    row[k] = value;
  });

  const vendor = normalizeVendor(row.vendor);

  return {
    sector: String(row.sector || "").trim(),
    project: String(row.project || "").trim(),
    account_item: String(row.account_item || "").trim(),
    status: String(row.status || "").trim(),

    request_id: String(row.request_id || "").trim(),
    code: String(row.code || "").trim(),
    vendor,

    amount_total: toNumber(row.amount_total),
    amount_paid: toNumber(row.amount_paid),
    amount_canceled: toNumber(row.amount_canceled),
    amount_remaining: toNumber(row.amount_remaining),

    source_request_date: String(row.source_request_date || "").trim(),
    payment_request_date: String(row.payment_request_date || "").trim(),
    approval_date: String(row.approval_date || "").trim(),
    payment_date: String(row.payment_date || "").trim(),

    _srcDate: parseDateISO(row.source_request_date),
    _payReqDate: parseDateISO(row.payment_request_date)
  };
}


function applyFilters(rows){
  return rows.filter(r => r.vendor);
}

function computeDataQuality(allRows){
  let excludedVendor = 0;
  let missingProject = 0;
  let badDates = 0;

  allRows.forEach(r => {
    if (!r.vendor) excludedVendor++;
    if (!r.project) missingProject++;

    if (
      (r.source_request_date && !r._srcDate) ||
      (r.payment_request_date && !r._payReqDate)
    ) {
      badDates++;
    }
  });

  return {
    total: allRows.length,
    excludedVendor,
    missingProject,
    badDates
  };
}


function render(){

  const dq = computeDataQuality(data);

document.getElementById("dq_total").textContent = dq.total;
document.getElementById("dq_excluded_vendor").textContent = dq.excludedVendor;
document.getElementById("dq_missing_project").textContent = dq.missingProject;
document.getElementById("dq_bad_dates").textContent = dq.badDates;

  
  const filtered = applyFilters(data);

  

  document.getElementById("kpi_total").textContent =
    fmtMoney(filtered.reduce((a,x)=>a+x.amount_total,0));

  document.getElementById("kpi_paid").textContent =
    fmtMoney(filtered.reduce((a,x)=>a+x.amount_paid,0));

  document.getElementById("kpi_remaining").textContent =
    fmtMoney(filtered.reduce((a,x)=>a+x.amount_remaining,0));

  document.getElementById("kpi_count").textContent =
    `عدد المطالبات: ${filtered.length}`;

  const tbody = document.getElementById("rows");
  tbody.innerHTML = filtered.map(r=>`
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

async function init(){
  const res = await fetch("./data.csv",{cache:"no-store"});
  const text = await res.text();
  data = parseCSV(text).map(normalizeRow);
  render();
}

init();
