import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "ar" | "en";

const ar = {
  app: "إدارة السلامة من الحريق", brand: "Talabat Mart",
  // auth
  username: "اسم المستخدم", password: "كلمة المرور", signIn: "تسجيل الدخول", signingIn: "جارٍ التحقق…", signOut: "تسجيل الخروج",
  badLogin: "اسم المستخدم أو كلمة المرور غير صحيحة.", tooMany: "محاولات كثيرة. استنى دقيقة وجرّب تاني.", noStaff: "الحساب ده مش مربوط بأي موظف نشط. كلّم مدير النظام.",
  newPassword: "كلمة مرور جديدة", confirmPassword: "تأكيد كلمة المرور", setPassword: "حفظ كلمة المرور", mustChange: "لازم تغيّر كلمة المرور قبل ما تكمل.",
  pwRule: "10 حروف على الأقل وفيها حرف ورقم.", pwMismatch: "كلمتين المرور مش متطابقين.", sessionEnded: "انتهت الجلسة بسبب عدم النشاط. سجّل دخولك تاني.",
  // nav
  dashboard: "لوحة المتابعة", stores: "الفروع", equipment: "إعداد المعدات", issues: "الأعطال", inspections: "سجل الفحوصات", reports: "حالة المعدات",
  zones: "المناطق", staff: "المستخدمين", settings: "الإعدادات", audit: "سجل التدقيق", myStores: "فروعي", history: "فحوصاتي", more: "المزيد",
  admin: "مدير", technician: "فني",
  // common
  save: "حفظ", saved: "اتحفظ", cancel: "إلغاء", close: "إغلاق", edit: "تعديل", add: "إضافة", search: "بحث بالاسم أو الكود", all: "الكل", none: "—",
  loading: "جارٍ التحميل…", retry: "حاول تاني", confirm: "تأكيد", yes: "نعم", no: "لا", active: "نشط", inactive: "موقوف", activate: "تفعيل", deactivate: "إيقاف",
  export: "تصدير CSV", refresh: "تحديث", empty: "مفيش بيانات لسه.", errorGeneric: "حصل خطأ. حاول تاني.", offline: "مفيش اتصال — هيتم الإرسال أول ما النت يرجع.",
  prev: "السابق", nextPage: "التالي", page: "صفحة", of: "من", week: "الأسبوع", weekOf: "أسبوع يبدأ", zone: "المنطقة", store: "الفرع", code: "الكود", name: "الاسم",
  tech: "الفني", status: "الحالة", date: "التاريخ", priority: "الأولوية", lastInspection: "آخر فحص", openIssues: "أعطال مفتوحة", flagged: "عليه علامة", notes: "ملاحظات",
  // statuses
  st_ok: "سليم", st_issues: "فيه مشاكل", st_pending: "لسه ما اتفحصش الأسبوع ده", st_overdue: "متأخر", st_never: "ما اتفحصش خالص",
  ov_ok: "كله سليم", ov_warn: "فيه مشاكل",
  pr_critical: "حرج", pr_high: "عالي", pr_medium: "متوسط", pr_low: "منخفض",
  is_open: "مفتوح", is_assigned: "متعيّن", is_in_progress: "جاري الإصلاح", is_resolved: "اتحل", is_closed: "مقفول",
  // dashboard
  completion: "نسبة الإنجاز", doneThisWeek: "فروع اتفحصت الأسبوع ده", totalStores: "إجمالي الفروع", activeStores: "فرع نشط",
  overdueHint: "آخر فحص أقدم من المسموح", neverHint: "مفيش أي فحص مسجل", noBase: "بدون كميات أساسية", criticalIssues: "حرجة",
  byZone: "الإنجاز حسب المنطقة", byTech: "أداء الفنيين", trend: "الفحوصات آخر 12 أسبوع", withIssues: "بمشاكل", byEquipment: "الأعطال حسب المعدة",
  byPriority: "الأعطال المفتوحة حسب الأولوية", storeMap: "خريطة الفروع", allZones: "كل المناطق",
  // stores
  addStore: "إضافة فرع", editStore: "تعديل فرع", storeCode: "كود الفرع", storeCodeHint: "الكود ثابت ومينفعش يتغيّر بعد الحفظ.", storeName: "اسم الفرع",
  assignedTech: "الفني المسؤول", unassigned: "بدون فني", flaggedOnly: "اللي عليها علامة بس", baseQty: "الكميات المثبتة",
  // equipment
  eqHint: "الكميات الثابتة لكل فرع. الفني بيشوفها بس ومش بيقدر يغيّرها.", missingBaseOnly: "اللي ناقصها كميات بس", changed: "متعدّل",
  // equipment types
  eq_p6: "طفايات بودرة 6 كجم", eq_co2: "طفايات CO2", eq_fs: "معدات Fire Search", eq_hc: "خزائن خراطيم الحريق", eq_al: "نظام إنذار الحريق", eq_fp: "طرمبة الحريق",
  // inspection values
  good: "سليمة", dmg: "تالفة", miss: "مفقودة",
  v_good: "سليم", v_damaged: "تالف", v_missing: "مفقود", v_stiff: "متصلب / عالق", v_broken: "مكسور / متشقق", v_low: "منخفضة", v_failed: "معطلة",
  v_dirty: "تالفة / متسخة", v_working: "تعمل", v_faulty: "خلل", v_ok: "يعمل بشكل طبيعي", v_fault: "يوجد عطل",
  v_running: "تعمل", v_not_running: "لا تعمل", v_tested: "تم التجربة", v_not_tested: "لم يتم التجربة", v_na: "لا يوجد بالفرع",
  hcOk: "خزائن سليمة تماماً", hose: "الخرطوم", valve: "الصمام", glass: "الزجاج / الباب", alSystem: "الحالة العامة للنظام", battery: "البطارية",
  detectors: "الكواشف (Detectors)", mcp: "نقاط النداء اليدوية (MCP)", sounders: "أجهزة الإنذار الصوتي", fpHas: "فيه طرمبة حريق في الفرع؟", fpRunning: "حالة التشغيل", fpTested: "اتجربت؟",
  installed: "المثبت بالفرع", tallyOk: "المجموع مظبوط", tallyBad: "المجموع لازم يساوي", now: "دلوقتي", remarks: "ملاحظات", remarksRequired: "الملاحظات مطلوبة لأن فيه مشكلة.",
  generalRemarks: "ملاحظات عامة", review: "مراجعة وإرسال", next: "التالي", back: "رجوع", submit: "إرسال الفحص", submitting: "جارٍ الإرسال…",
  willOpen: "أعطال هتتفتح تلقائياً", noIssuesFound: "مفيش أعطال — كل المعدات سليمة", startInspection: "ابدأ الفحص", continueDraft: "كمّل المسودة",
  doneWeek: "اتفحص الأسبوع ده", noBaseTech: "الكميات الأساسية مش متسجلة — كلّم الإدارة", submitted: "اتبعت الفحص", queued: "اتحفظ على الجهاز وهيتبعت أول ما النت يرجع",
  inspectionCode: "رقم الفحص", backToStores: "رجوع للفروع", pendingSync: "مستني الإرسال", syncNow: "إرسال دلوقتي", syncFailed: "الإرسال فشل",
  discardDraft: "حذف المسودة", draftSaved: "المسودة محفوظة على الجهاز",
  duplicateWeek: "الفرع ده اتفحص الأسبوع ده بالفعل.", overrideReason: "سبب تكرار الفحص (للمدير فقط)", override: "تكرار الفحص",
  // issues
  assign: "تعيين", startRepair: "بدء الإصلاح", resolve: "تسجيل الحل", reopen: "إعادة فتح", closeIssue: "قفل", assignTo: "تعيين لـ", resolutionNotes: "تفاصيل الحل",
  resolvedAt: "تاريخ الحل", fromInspection: "من فحص", createdAt: "تاريخ الفتح", issueHistory: "سجل العطل",
  // staff
  addStaff: "إضافة مستخدم", fullName: "الاسم بالكامل", role: "الصلاحية", phone: "الموبايل", login: "حساب الدخول", createLogin: "إنشاء حساب دخول",
  resetPassword: "تغيير كلمة المرور", noLogin: "مفيش حساب", tempPassword: "كلمة مرور مؤقتة (هيغيّرها أول دخول)", legacy: "الكود القديم",
  // zones
  addZone: "إضافة منطقة", nameAr: "الاسم بالعربي", nameEn: "الاسم بالإنجليزي", sort: "الترتيب",
  // settings
  general: "عام", appNameAr: "اسم التطبيق (عربي)", appNameEn: "اسم التطبيق (إنجليزي)", loginMsgAr: "رسالة الدخول (عربي)", loginMsgEn: "رسالة الدخول (إنجليزي)",
  overdueDays: "يُعتبر الفرع متأخر بعد (يوم)", requireRemarks: "إلزام الفني بكتابة ملاحظات لما يكون فيه مشكلة", idleMinutes: "تسجيل خروج تلقائي بعد عدم نشاط (دقيقة)",
  eqTypes: "أنواع المعدات في الفحص", eqTypesHint: "تقدر تغيّر الأسماء أو توقف نوع. النوع الموقوف مش بيظهر في الفحص.", backup: "نسخة احتياطية",
  backupHint: "تنزيل نسخة JSON من كل الجداول اللي عندك صلاحية عليها.",
  techScope: "الفروع اللي بتظهر للفني", scopeAssigned: "الفروع المتعيّنة له بالاسم بس", scopeZone: "كل فروع منطقته + المتعيّنة له",
  techScopeHint: "في وضع (كل فروع منطقته) لازم تحدد منطقة لكل فني من صفحة المستخدمين. أكتر من فني ممكن يشتغلوا على نفس المنطقة، والفرع بيتفحص مرة واحدة في الأسبوع.", downloadBackup: "تنزيل النسخة", language: "اللغة", theme: "المظهر",
  // audit
  action: "الإجراء", entity: "الجدول", actor: "بواسطة", details: "التفاصيل",
  // misc
  preview: "معاينة", dark: "ليلي", light: "فاتح", system: "حسب الجهاز", installApp: "تثبيت التطبيق", updateReady: "فيه تحديث جديد", updateNow: "حدّث دلوقتي",
};

type Dict = typeof ar;
export type TKey = keyof Dict;

const en: Dict = {
  app: "Fire Safety Management", brand: "Talabat Mart",
  username: "Username", password: "Password", signIn: "Sign in", signingIn: "Checking…", signOut: "Sign out",
  badLogin: "Wrong username or password.", tooMany: "Too many attempts. Wait a minute and try again.", noStaff: "This login is not linked to an active staff member. Contact the administrator.",
  newPassword: "New password", confirmPassword: "Confirm password", setPassword: "Save password", mustChange: "You need to change your password before continuing.",
  pwRule: "At least 10 characters with a letter and a number.", pwMismatch: "Passwords don't match.", sessionEnded: "Session ended after inactivity. Sign in again.",
  dashboard: "Dashboard", stores: "Stores", equipment: "Equipment setup", issues: "Issues", inspections: "Inspection log", reports: "Equipment status",
  zones: "Zones", staff: "Users", settings: "Settings", audit: "Audit log", myStores: "My stores", history: "My inspections", more: "More",
  admin: "Admin", technician: "Technician",
  save: "Save", saved: "Saved", cancel: "Cancel", close: "Close", edit: "Edit", add: "Add", search: "Search name or code", all: "All", none: "—",
  loading: "Loading…", retry: "Try again", confirm: "Confirm", yes: "Yes", no: "No", active: "Active", inactive: "Inactive", activate: "Activate", deactivate: "Deactivate",
  export: "Export CSV", refresh: "Refresh", empty: "Nothing here yet.", errorGeneric: "Something went wrong. Try again.", offline: "Offline — will send when the connection is back.",
  prev: "Previous", nextPage: "Next", page: "Page", of: "of", week: "Week", weekOf: "Week of", zone: "Zone", store: "Store", code: "Code", name: "Name",
  tech: "Technician", status: "Status", date: "Date", priority: "Priority", lastInspection: "Last inspection", openIssues: "Open issues", flagged: "Flagged", notes: "Notes",
  st_ok: "All OK", st_issues: "Issues found", st_pending: "Due this week", st_overdue: "Overdue", st_never: "Never inspected",
  ov_ok: "All OK", ov_warn: "Issues found",
  pr_critical: "Critical", pr_high: "High", pr_medium: "Medium", pr_low: "Low",
  is_open: "Open", is_assigned: "Assigned", is_in_progress: "In progress", is_resolved: "Resolved", is_closed: "Closed",
  completion: "Completion", doneThisWeek: "stores inspected this week", totalStores: "Total stores", activeStores: "active stores",
  overdueHint: "last inspection older than allowed", neverHint: "no inspection on record", noBase: "No base quantities", criticalIssues: "critical",
  byZone: "Completion by zone", byTech: "Technician performance", trend: "Inspections, last 12 weeks", withIssues: "with issues", byEquipment: "Open issues by equipment",
  byPriority: "Open issues by priority", storeMap: "Store map", allZones: "All zones",
  addStore: "Add store", editStore: "Edit store", storeCode: "Store code", storeCodeHint: "The code is permanent and can't be changed after saving.", storeName: "Store name",
  assignedTech: "Assigned technician", unassigned: "Unassigned", flaggedOnly: "Flagged only", baseQty: "Base quantities",
  eqHint: "Permanent quantities per store. Technicians can see them but can't change them.", missingBaseOnly: "Missing quantities only", changed: "Changed",
  eq_p6: "6 kg powder extinguishers", eq_co2: "CO2 extinguishers", eq_fs: "Fire Search equipment", eq_hc: "Hose cabinets", eq_al: "Fire alarm system", eq_fp: "Fire pump",
  good: "Good", dmg: "Damaged", miss: "Missing",
  v_good: "Good", v_damaged: "Damaged", v_missing: "Missing", v_stiff: "Stiff / stuck", v_broken: "Cracked / broken", v_low: "Low", v_failed: "Failed",
  v_dirty: "Damaged / dirty", v_working: "Working", v_faulty: "Faulty", v_ok: "Working normally", v_fault: "Fault",
  v_running: "Running", v_not_running: "Not running", v_tested: "Tested", v_not_tested: "Not tested", v_na: "Not at store",
  hcOk: "Fully working cabinets", hose: "Hose", valve: "Valve", glass: "Glass / door", alSystem: "Overall system status", battery: "Battery",
  detectors: "Detectors", mcp: "Manual call points (MCP)", sounders: "Sounders", fpHas: "Is there a fire pump at the store?", fpRunning: "Running status", fpTested: "Tested?",
  installed: "Installed at store", tallyOk: "Totals match", tallyBad: "Total must equal", now: "now", remarks: "Remarks", remarksRequired: "Remarks are required because there's an issue.",
  generalRemarks: "General remarks", review: "Review & submit", next: "Next", back: "Back", submit: "Submit inspection", submitting: "Submitting…",
  willOpen: "Issues that will be opened automatically", noIssuesFound: "No issues — all equipment OK", startInspection: "Start inspection", continueDraft: "Continue draft",
  doneWeek: "Inspected this week", noBaseTech: "Base quantities not set — contact admin", submitted: "Inspection submitted", queued: "Saved on this device and will be sent when online",
  inspectionCode: "Inspection no.", backToStores: "Back to stores", pendingSync: "Waiting to send", syncNow: "Send now", syncFailed: "Sending failed",
  discardDraft: "Delete draft", draftSaved: "Draft saved on this device",
  duplicateWeek: "This store was already inspected this week.", overrideReason: "Reason for repeating (admins only)", override: "Repeat inspection",
  assign: "Assign", startRepair: "Start repair", resolve: "Record resolution", reopen: "Reopen", closeIssue: "Close", assignTo: "Assign to", resolutionNotes: "Resolution details",
  resolvedAt: "Resolved on", fromInspection: "From inspection", createdAt: "Opened on", issueHistory: "Issue history",
  addStaff: "Add user", fullName: "Full name", role: "Role", phone: "Mobile", login: "Login", createLogin: "Create login",
  resetPassword: "Reset password", noLogin: "No login", tempPassword: "Temporary password (changed at first sign-in)", legacy: "Legacy code",
  addZone: "Add zone", nameAr: "Arabic name", nameEn: "English name", sort: "Order",
  general: "General", appNameAr: "App name (Arabic)", appNameEn: "App name (English)", loginMsgAr: "Sign-in message (Arabic)", loginMsgEn: "Sign-in message (English)",
  overdueDays: "Store is overdue after (days)", requireRemarks: "Require technician remarks when there's an issue", idleMinutes: "Sign out after inactivity (minutes)",
  eqTypes: "Equipment types in the inspection", eqTypesHint: "Rename or switch off a type. Switched-off types are skipped in the inspection.", backup: "Backup",
  backupHint: "Download a JSON copy of every table you can access.",
  techScope: "Stores shown to a technician", scopeAssigned: "Only stores assigned to them by name", scopeZone: "All stores in their zone + assigned ones",
  techScopeHint: "In zone mode, set a zone for each technician on the Users page. Several technicians can share a zone; each store is still inspected once per week.", downloadBackup: "Download backup", language: "Language", theme: "Appearance",
  action: "Action", entity: "Table", actor: "By", details: "Details",
  preview: "Preview", dark: "Dark", light: "Light", system: "System", installApp: "Install app", updateReady: "A new version is available", updateNow: "Update now",
};

const DICTS: Record<Lang, Dict> = { ar, en };

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string; dir: "rtl" | "ltr"; nf: (n: number) => string; df: (iso: string | null | undefined, withTime?: boolean) => string; }
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("fs-lang") as Lang) || "ar");
  const setLang = (l: Lang) => { localStorage.setItem("fs-lang", l); setLangState(l); };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const value = useMemo<I18n>(() => {
    const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
    const nfmt = new Intl.NumberFormat(locale);
    return {
      lang, setLang, dir: lang === "ar" ? "rtl" : "ltr",
      t: (k) => DICTS[lang][k] ?? String(k),
      nf: (n) => nfmt.format(n ?? 0),
      df: (iso, withTime) => {
        if (!iso) return "—";
        const d = iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleString(locale, withTime
          ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }
          : { day: "numeric", month: "short", year: "numeric" });
      },
    };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("I18nProvider missing");
  return v;
}

export function useDictKeys() { return Object.keys(ar) as TKey[]; }
