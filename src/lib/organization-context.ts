import { selectActiveOrganization } from "./organization-selection.mjs";

export type OrganizationOption = {
  organization_id: string;
  role: string;
  trade_name: string | null;
  legal_name: string | null;
  status?: string | null;
  trial_ends_at?: string | null;
};

const ACTIVE_ORGANIZATION_KEY = "esc-active-organization-id";

export function rememberActiveOrganization(organizationId: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ACTIVE_ORGANIZATION_KEY, organizationId);
  }
}

export async function resolveActiveOrganization(
  client: any,
  userId: string
): Promise<{
  membership: OrganizationOption | null;
  organizations: OrganizationOption[];
  error: { message: string } | null;
}> {
  const { data: memberships, error: membershipError } = await client
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("user_id", userId)
    .eq("status", "active");

  if (membershipError) {
    return { membership: null, organizations: [], error: { message: membershipError.message } };
  }

  if (!memberships?.length) {
    return { membership: null, organizations: [], error: null };
  }

  const organizationIds = memberships.map((item: { organization_id: string }) => item.organization_id);
  const { data: organizations, error: organizationError } = await client
    .from("organizations")
    .select("id,trade_name,legal_name,status,trial_ends_at")
    .in("id", organizationIds);

  if (organizationError) {
    return { membership: null, organizations: [], error: { message: organizationError.message } };
  }

  const options: OrganizationOption[] = (memberships as Array<{ organization_id: string; role: string }>).flatMap((item) => {
    const organization = (organizations || []).find((entry: { id: string }) => entry.id === item.organization_id);
    return organization ? [{
      organization_id: item.organization_id,
      role: item.role,
      trade_name: organization.trade_name || null,
      legal_name: organization.legal_name || null,
      status: organization.status || null,
      trial_ends_at: organization.trial_ends_at || null,
    }] : [];
  });

  if (!options.length) {
    return { membership: null, organizations: [], error: { message: "Nenhuma organização ativa foi encontrada para sua conta." } };
  }

  const storedId = typeof window !== "undefined"
    ? window.localStorage.getItem(ACTIVE_ORGANIZATION_KEY)
    : null;
  const { selected } = selectActiveOrganization(options, storedId);

  if (selected && options.length === 1 && storedId !== selected.organization_id) {
    rememberActiveOrganization(selected.organization_id);
  }

  if (!selected) {
    return {
      membership: null,
      organizations: options,
      error: { message: "Sua conta possui acesso a mais de uma organização. Selecione o ambiente de trabalho no painel." },
    };
  }

  return { membership: selected, organizations: options, error: null };
}
