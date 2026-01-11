// docs/src/schema.js
// =====================================
// Data Contract - Schema v1
// =====================================

export const SCHEMA_VERSION = 1;

// الأعمدة الأساسية اللي النظام بيفهمها
export const COLUMNS = {
  sector: {
    label: "القطاع",
    required: false
  },
  project: {
    label: "المشروع",
    required: true
  },
  account_item: {
    label: "بند الحسابات",
    required: true,
    allowed: [
      "موردين",
      "مقاولين باطن",
      "سدادات",
      "عهدة",
      "تصاريح حفر"
    ]
  },
  status: {
    label: "الحالة",
    required: false,
    allowed: [
      "Pending",
      "Partially Paid",
      "Paid",
      "Canceled"
    ]
  },
  request_id: {
    label: "رقم الطلب",
    required: false
  },
  code: {
    label: "كود الحساب",
    required: true
  },
  vendor: {
    label: "المورد / المقاول",
    required: true   // 👈 القاعدة الذهبية
  },
  amount_total: {
    label: "المبلغ",
    required: true
  },
  amount_paid: {
    label: "المنصرف",
    required: false
  },
  amount_canceled: {
    label: "الملغي",
    required: false
  },
  amount_remaining: {
    label: "المتبقي",
    required: true
  },
  source_request_date: {
    label: "تاريخ الطلب (من المشروع)",
    required: false
  },
  payment_request_date: {
    label: "تاريخ طلب الصرف",
    required: false
  },
  approval_date: {
    label: "تاريخ التعميد",
    required: false
  },
  payment_date: {
    label: "تاريخ الصرف",
    required: false
  }
};

// مابينج عربي / إنجليزي
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
  "تاريخ الصرف": "payment_date"
};
