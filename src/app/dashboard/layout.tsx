"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const routePermissions: Array<[string, string]> = [
  ["/dashboard/acessos", "roles.manage"],
  ["/dashboard/relatorios", "reports.view"],
  ["/dashboard/colaboradores", "employees.view"],
  ["/dashboard/admissao", "admissions.view"],
  ["/dashboard/departamentos", "departments.view"],
  ["/dashboard/cargos", "positions.view"],
  ["/dashboard/ferias", "vacations.view"],
  ["/dashboard/afastamentos", "absences.view"],
  ["/dashboard/beneficios", "benefits.view"],
  ["/dashboard/documentos", "documents.view"],
  ["/dashboard/treinamentos", "training.view"],
  ["/dashboard/avaliacoes", "performance.view"],
  ["/dashboard/saude-ocupacional", "occupational_health.view"],
  ["/dashboard/frequencia", "attendance.view"],
  ["/dashboard/folha", "payroll.view"],
  ["/dashboard", "dashboard.view"],
];

function permissionForPath(path: string) {
  return routePermissions.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"))?.[1] ?? null;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<"loading" | "allowed" | "denied">("loading");
  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    const syncOrganization = () => setSelectedOrgId(window.localStorage.getItem("esc_selected_org_id") || "");
    syncOrganization();
    window.addEventListener("esc:organization-changed", syncOrganization);
    window.addEventListener("storage", syncOrganization);
    return () => {
      window.removeEventListener("esc:organization-changed", syncOrganization);
      window.removeEventListener("storage", syncOrganization);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function verifyAccess() {
      setState("loading");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }

      const { data: memberships, error } = await supabase
        .from("organization_memberships")
        .select("organization_id, role_id")
        .eq("user_id", user.id)
        .eq("status", "active");

      if (error || !memberships?.length) {
        if (!cancelled) setState("denied");
        return;
      }

      const savedOrg = window.localStorage.getItem("esc_selected_org_id");
      const requestedOrg = selectedOrgId || savedOrg;
      const membership = memberships.find((item) => item.organization_id === requestedOrg) || memberships[0];
      if (!savedOrg || savedOrg !== membership.organization_id) {
        window.localStorage.setItem("esc_selected_org_id", membership.organization_id);
      }

      const requiredPermission = permissionForPath(pathname);
      if (!requiredPermission || !membership.role_id) {
        if (!cancelled) setState("denied");
        return;
      }

      const { data: permission, error: permissionError } = await supabase
        .from("organization_role_permissions")
        .select("allowed")
        .eq("role_id", membership.role_id)
        .eq("permission_key", requiredPermission)
        .maybeSingle();

      if (!cancelled) setState(!permissionError && permission?.allowed === true ? "allowed" : "denied");
    }

    void verifyAccess();
    return () => { cancelled = true; };
  }, [pathname, router, selectedOrgId]);

  if (state === "loading") {
    return <div className="loading-screen">Validando acesso à organização...</div>;
  }

  if (state === "denied") {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7fb" }}>
        <section style={{ width: "100%", maxWidth: 460, padding: 32, borderRadius: 18, background: "#fff", border: "1px solid #e5eaf2", textAlign: "center" }}>
          <ShieldAlert size={38} color="#dc6b45" style={{ margin: "0 auto 16px" }} />
          <h1 style={{ margin: "0 0 8px", fontSize: 21, color: "#182230" }}>Acesso não autorizado</h1>
          <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>Seu perfil não possui permissão para abrir esta área na organização selecionada. Solicite ao administrador a revisão das permissões.</p>
          <button onClick={() => router.replace("/dashboard")} style={{ marginTop: 22, border: 0, borderRadius: 10, padding: "11px 18px", background: "#243b6b", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Voltar ao painel</button>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
