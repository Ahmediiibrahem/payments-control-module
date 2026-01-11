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

function normalizeRow(r){
  const vendor = normalizeVendor(r.vendor || r["المورد"]);
  return {
    sector: r.sector || r["القطاع"] || "",
    project: r.project || r["المشروع"] || "",
    account_item: r.account_item || r["بند الحسابات"] || "",
    status: r.status || r["الحالة"] || "",
    request_id: r.request_id || r["رقم الطلب"] || "",
    code: r.code || r["الكود"] || "",
    vendor,
    amount_total: toNumber(r.amount_total || r["المبلغ"]),
    amount_paid: toNumber(r.amount_paid || r["المنصرف"]),
    amount_canceled: toNumber(r.amount_canceled || r["الملغي"]),
    amount_remaining: toNumber(r.amount_remaining || r["المتبقي"]),
    source_request_date: r.source_request_date || "",
    payment_request_date: r.payment_request_date || "",
    approval_date: r.approval_date || "",
    payment_date: r.payment_date || "",
    _srcDate: parseDateISO(r.source_request_date),
    _payReqDate: parseDateISO(r.payment_request_date)
  };
}

function applyFilters(rows){
  return rows.filter(r => r.vendor);
}

function render(){
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
