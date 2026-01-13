// docs/src/auth.js
// ملاحظة: ده Gate على الواجهة فقط (مش حماية سيرفر حقيقية).

const SESSION_KEY = "pc_auth_ok";

// ✅ غيّر دول للي انت عايزه
const USERS = [
  { user: "admin", pass: "1902" },
  // { user: "ahmed", pass: "0000" },
];

export function isAuthed(){
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

export function login(user, pass){
  user = String(user || "").trim();
  pass = String(pass || "").trim();

  const ok = USERS.some(u => u.user === user && u.pass === pass);
  if (ok) sessionStorage.setItem(SESSION_KEY, "1");
  return ok;
}

export function logout(){
  sessionStorage.removeItem(SESSION_KEY);
  window.location.href = "./login.html";
}

// استدعِها أول سطر في الصفحات المحمية
export function requireAuth(){
  if (isAuthed()) return;

  // احفظ الصفحة المطلوبة عشان بعد اللوجين يرجع لها
  sessionStorage.setItem("pc_next", window.location.pathname.split("/").pop() || "index.html");
  window.location.href = "./login.html";
}
