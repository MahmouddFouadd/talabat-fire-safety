# DEPLOYMENT_GUIDE — خطوات التشغيل بالترتيب

> كل الخطوات دي ممكن تتعمل من الموبايل من خلال المتصفح.

## 0) أمان قبل أي حاجة
- اعمل **Roll** لمفتاح `sb_secret_…` من Supabase ← Project Settings ← API Keys، لأنه اتكتب في الشات.
- غيّر الـ PINs في شيت الـ Pilot القديم، أو وقّف نشر الـ Apps Script، لأن الـ PINs مكشوفة في الكود.

## 1) قاعدة البيانات — اختار طريقة واحدة

**الطريقة (أ) — SQL Editor (الأسهل أول مرة):**
1. Supabase ← SQL Editor ← New query.
2. الصق محتوى `supabase/setup_all.sql` كله، ودوس Run. الملف آمن لو اتشغّل أكتر من مرة.
3. Edge Function `admin-users` محتاجة الطريقة (ب)، أو Supabase CLI من لابتوب.

**الطريقة (ب) — GitHub Action (بتعمل الاتنين):**
1. GitHub ← Settings ← Secrets and variables ← Actions، وضيف:
   - `SUPABASE_ACCESS_TOKEN`: من supabase.com ← Account ← Access Tokens.
   - `SUPABASE_DB_PASSWORD`: باسورد قاعدة البيانات من Project Settings ← Database.
2. Actions ← **Deploy database & functions (manual)** ← Run workflow، واكتب `DEPLOY`.

## 2) Auth
- Authentication ← Providers ← Email: سيبه شغال، **واقفل "Allow new users to sign up"**. الحسابات بيعملها المدير بس.
- Authentication ← Sign In / Up ← Confirm email: مش مهم، لأن الحسابات بتتعمل مؤكدة.

## 3) أول مدير (مرة واحدة)
1. Authentication ← Users ← **Add user**:
   - Email: `admin01@fs.local`
   - Password: كلمة مرور قوية
   - علّم على **Auto Confirm User**
2. SQL Editor، شغّل:
   ```sql
   select public.bootstrap_admin('admin01@fs.local');
   ```
3. ادخل التطبيق باسم المستخدم `admin01` وكلمة المرور دي.
4. من **المستخدمين** اعمل لكل فني "إنشاء حساب دخول" بكلمة مرور مؤقتة، وهو هيغيّرها أول ما يدخل.
   - المقترح: tech001…tech004، ولو حابب أي اسم تاني غيّره.

## 4) الموقع (للابتوب والآيفون)
- **الطريقة (أ):** Cloudflare Pages ← Create ← Connect to Git ← `talabat-fire-safety`.
  - Build command: `npm run build`
  - Output: `dist`
- **الطريقة (ب):** ضيف `CLOUDFLARE_API_TOKEN` و`CLOUDFLARE_ACCOUNT_ID` كـ Secrets، والـ workflow هيرفع تلقائياً مع كل push.
- بعد ما الموقع يشتغل، ضيف رابطه في Supabase ← Edge Functions ← admin-users ← Secrets:
  - `ALLOWED_ORIGINS=https://talabat-fire-safety.pages.dev,https://localhost`

## 5) تطبيق الأندرويد
- Actions ← **Android APK** ← Run workflow. بعد حوالي 8 دقايق نزّل الـ Artifact، وجواه `FireSafety-…-debug.apk`.
- للنسخة الرسمية الموقّعة والـ AAB، شوف `MOBILE_BUILD_GUIDE.md`.

## 6) الآيفون
افتح رابط الموقع من Safari ← زرار المشاركة ← **Add to Home Screen**.

## 7) بعد التشغيل
- من **إعداد المعدات** فلتر على "اللي ناقصها كميات". فيه 12 فرع لازم تكمّل كمياتهم قبل ما الفني يقدر يفحصهم.
- راجع **المناطق** و**المستخدمين** وصحّح الأسماء.
