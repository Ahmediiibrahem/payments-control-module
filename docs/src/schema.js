export const SCHEMA_VERSION = 1;

export const HEADER_MAP = {
  "القطاع": "sector",
  "قطاع": "sector",
  "المشروع": "project",
  " المشروع": "project",
  "بند الحسابات": "account_item",
  "الحالة": "status",
  "رقم الطلب": "request_id",
  "الكود": "code",
  "كود الحساب": "code",
  "المورد": "vendor",
  "المورد/ المقاول": "vendor",
  "المورد/المقاول": "vendor",
  "المبلغ": "amount_total",
  "المنصرف": "amount_paid",
  "ملغي": "amount_canceled",
  "الملغي": "amount_canceled",
  "المتبقي": "amount_remaining",
  "تاريخ الطلب (المصدر)": "source_request_date",
  "تاريخ الطلب من المشروع": "source_request_date",
  "تاريخ الطلب (الصرف)": "payment_request_date",
  "تاريخ طلب الصرف": "payment_request_date",
  "تاريخ التعميد": "approval_date",
  "تاريخ الصرف": "payment_date",

  // Old (keep for backward compatibility)
  "Time": "time_code",
  "time": "time_code",
  "TIME": "time_code",

  // ✅ NEW: human readable time
  "Exacttime": "exact_time",
  "ExactTime": "exact_time",
  "EXACTTIME": "exact_time",
  "exacttime": "exact_time",
};
