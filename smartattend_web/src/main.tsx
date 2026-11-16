import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { AuthProvider } from "./lib/auth-context";
import ErrorBoundary from "./components/ErrorBoundary";
import { BootFailed } from "./components/BootScreen";
import { supabaseConfigError } from "./integrations/supabase/client";
import "./index.css";

const root = document.getElementById("root")!;

// ตั้งค่าไม่ครบ = เข้าแอปไปก็ทำอะไรไม่ได้ จึงหยุดแล้วบอกสาเหตุบนหน้าจอเลย
// ไม่ปล่อยให้พังกลางทางจนกลายเป็นจอขาว
if (supabaseConfigError) {
  createRoot(root).render(
    <BootFailed
      title="ยังตั้งค่าระบบไม่ครบ"
      detail={supabaseConfigError}
      showSignOut={false}
    />
  );
} else {
  createRoot(root).render(
    // ErrorBoundary อยู่นอกสุด เพื่อให้ครอบ error จากทุกอย่างรวมถึง AuthProvider
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
