import { lazy, Suspense, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";

const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Stores = lazy(() => import("./pages/admin/Stores"));
const Equipment = lazy(() => import("./pages/admin/Equipment"));
const Issues = lazy(() => import("./pages/admin/Issues"));
const Inspections = lazy(() => import("./pages/admin/Inspections"));
const Reports = lazy(() => import("./pages/admin/Reports"));
const Zones = lazy(() => import("./pages/admin/Zones"));
const Staff = lazy(() => import("./pages/admin/Staff"));
const Settings = lazy(() => import("./pages/admin/Settings"));
const Audit = lazy(() => import("./pages/admin/Audit"));
const MyStores = lazy(() => import("./pages/tech/MyStores"));
const Inspect = lazy(() => import("./pages/tech/Inspect"));

function AdminOnly({ children }: { children: ReactNode }) {
  const { staff } = useAuth();
  return staff?.role === "admin" ? <>{children}</> : <Navigate to="/tech" replace />;
}

export default function App() {
  const { session, staff, loading, mustChangePassword } = useAuth();
  if (loading) return <Loading />;
  if (!session || !staff) return <Login />;
  if (mustChangePassword) return <ChangePassword />;
  const home = staff.role === "admin" ? "/admin" : "/tech";
  return (
    // HashRouter works the same on static hosting, in the installed PWA and inside the Android app.
    <HashRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/admin" element={<AdminOnly><Dashboard /></AdminOnly>} />
          <Route path="/admin/stores" element={<AdminOnly><Stores /></AdminOnly>} />
          <Route path="/admin/equipment" element={<AdminOnly><Equipment /></AdminOnly>} />
          <Route path="/admin/issues" element={<AdminOnly><Issues /></AdminOnly>} />
          <Route path="/admin/inspections" element={<AdminOnly><Inspections /></AdminOnly>} />
          <Route path="/admin/reports" element={<AdminOnly><Reports /></AdminOnly>} />
          <Route path="/admin/zones" element={<AdminOnly><Zones /></AdminOnly>} />
          <Route path="/admin/staff" element={<AdminOnly><Staff /></AdminOnly>} />
          <Route path="/admin/settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="/admin/audit" element={<AdminOnly><Audit /></AdminOnly>} />
          <Route path="/tech" element={<MyStores />} />
          <Route path="/tech/history" element={<Inspections techMode />} />
          <Route path="/tech/inspect/:code" element={<Inspect />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
