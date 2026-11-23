import type { Lang } from "./i18n";

const MSG: Record<string, [string, string]> = {
  NOT_AUTHORIZED: ["مش مسموح لك تعمل العملية دي.", "You are not allowed to do this."],
  STORE_NOT_FOUND: ["الفرع مش موجود أو موقوف.", "Store not found or inactive."],
  STORE_NOT_ASSIGNED: ["الفرع ده مش متعيّن لك.", "This store is not assigned to you."],
  NO_BASE_QUANTITIES: ["الكميات الأساسية للفرع مش متسجلة. كلّم الإدارة.", "Base quantities for this store are not set. Contact admin."],
  DUPLICATE_WEEK: ["الفرع ده اتفحص الأسبوع ده بالفعل.", "This store was already inspected this week."],
  OVERRIDE_ADMIN_ONLY: ["تكرار الفحص للمدير بس.", "Only an admin can repeat an inspection."],
  OVERRIDE_REASON_REQUIRED: ["اكتب سبب تكرار الفحص.", "Enter a reason for repeating the inspection."],
  COUNT_MISMATCH: ["مجموع السليم والتالف والمفقود لازم يساوي الكمية المثبتة.", "Good + damaged + missing must equal the installed quantity."],
  INVALID_COUNT: ["فيه رقم غير صحيح.", "One of the counts is invalid."],
  MISSING_FIELD: ["فيه اختيار ناقص في الفحص.", "A required choice is missing."],
  REMARKS_REQUIRED: ["الملاحظات مطلوبة لكل معدة فيها مشكلة.", "Remarks are required for every item with an issue."],
  RESOLUTION_NOTES_REQUIRED: ["اكتب تفاصيل الحل.", "Enter the resolution details."],
  ASSIGNEE_REQUIRED: ["اختار حد تعيّن له العطل.", "Choose who to assign the issue to."],
  INVALID_TRANSITION: ["مينفعش تغيّر الحالة بالشكل ده.", "That status change is not allowed."],
  LAST_ADMIN: ["لازم يفضل مدير واحد نشط على الأقل.", "At least one active admin must remain."],
  AUTH_LINK_LOCKED: ["ربط حساب الدخول بيتم من زرار (إنشاء حساب دخول) بس.", "Logins are linked only through “Create login”."],
  HAS_HISTORY: ["فيه سجل فحوصات مرتبط بيه. اعمله إيقاف بدل الحذف عشان التاريخ يفضل سليم.", "It has inspection history. Deactivate it instead so history stays intact."],
  BUILTIN_TYPE: ["النوع ده أساسي في الفحص. تقدر توقفه بس، مش تمسحه.", "This is a built-in type. You can switch it off, not delete it."],
  CANNOT_DELETE_SELF: ["مينفعش تمسح حسابك انت.", "You can't delete yourself."],
  WEAK_PIN: ["الـ PIN ضعيف: 4 لـ 6 أرقام، مش متتالية ولا متكررة.", "Weak PIN: 4–6 digits, not a sequence or repeats."],
  PHONE_TAKEN: ["رقم الموبايل ده مسجّل لمستخدم تاني.", "This mobile number belongs to another user."],
  USERNAME_TAKEN: ["اسم المستخدم ده مستخدم قبل كده.", "That username is taken."],
  INVALID_USERNAME: ["اسم المستخدم: حروف إنجليزي صغيرة وأرقام و . _ - من 3 لـ 32.", "Username: 3–32 lowercase letters, digits, . _ -"],
  WEAK_PASSWORD: ["كلمة المرور ضعيفة: 10 حروف على الأقل وفيها حرف ورقم.", "Weak password: at least 10 characters with a letter and a number."],
  LOGIN_EXISTS: ["المستخدم ده عنده حساب دخول بالفعل.", "This user already has a login."],
  CANNOT_DISABLE_SELF: ["مينفعش توقف حسابك انت.", "You can't deactivate yourself."],
  "23505": ["القيمة دي موجودة قبل كده.", "That value already exists."],
  "23514": ["فيه قيمة خارج الحدود المسموحة.", "A value is outside the allowed range."],
  "42501": ["مش مسموح لك تعمل العملية دي.", "You are not allowed to do this."],
  NETWORK: ["مفيش اتصال بالإنترنت.", "No internet connection."],
  SESSION_EXPIRED: ["انتهت الجلسة. سجّل الدخول مرة أخرى.", "Your session has ended. Please sign in again."],
  NOT_AUTHENTICATED: ["انتهت الجلسة. سجّل الدخول مرة أخرى.", "Your session has ended. Please sign in again."],
  EMAIL_EXISTS: ["اسم المستخدم ده عليه حساب دخول قديم. اختار اسم مستخدم تاني.", "That username already has an (old) login. Choose another username."],
  CREATE_FAILED: ["مقدرناش ننشئ حساب الدخول.", "Could not create the login."],
  LINK_FAILED: ["اتعمل الحساب بس مقدرناش نربطه بالموظف. حاول تاني.", "The login could not be linked to the staff member. Try again."],
  RESET_FAILED: ["مقدرناش نغيّر كلمة المرور.", "Could not reset the password."],
  NO_LOGIN: ["المستخدم ده معندوش حساب دخول.", "This user has no login."],
  STAFF_NOT_FOUND: ["الموظف مش موجود.", "Staff member not found."],
  INVALID_STAFF_ID: ["الموظف مش موجود.", "Staff member not found."],
  UPDATE_FAILED: ["مقدرناش نحفظ التغيير.", "Could not save the change."],
  DELETE_FAILED: ["مقدرناش نمسح.", "Could not delete."],
  SERVER_ERROR: ["حصل خطأ في السيرفر. حاول تاني.", "Server error. Try again."],
};

export function errorCode(e: unknown): string {
  const anyE = e as { message?: string; code?: string; context?: { error?: string } } | null;
  const msg = anyE?.message ?? "";
  if (/Failed to fetch|NetworkError|Load failed|aborted|AbortError|timed? ?out/i.test(msg) || (e as { name?: string } | null)?.name === "AbortError") return "NETWORK";
  const key = Object.keys(MSG).find((k) => msg.startsWith(k));
  if (key) return key;
  if (anyE?.code && MSG[anyE.code]) return anyE.code;
  return msg || "UNKNOWN";
}

export function errorText(e: unknown, lang: Lang): string {
  const code = errorCode(e);
  const m = MSG[code];
  const detail = (e as { detail?: string } | null)?.detail;
  if (m) return m[lang === "ar" ? 0 : 1] + (detail && /_FAILED$/.test(code) ? ` (${detail})` : "");
  // show the code so an unexpected failure can be reported instead of guessed at
  const ref = code && code !== "UNKNOWN" ? ` (${code.slice(0, 60)})` : "";
  return (lang === "ar" ? "حصل خطأ. حاول تاني." : "Something went wrong. Try again.") + ref;
}
