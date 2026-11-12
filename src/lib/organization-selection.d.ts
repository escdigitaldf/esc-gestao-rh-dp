export type OrganizationSelectionResult<T> = {
  selected: T | null;
  requiresSelection: boolean;
};

export function selectActiveOrganization<T extends { organization_id: string }>(
  organizations: T[],
  storedOrganizationId: string | null | undefined
): OrganizationSelectionResult<T>;
