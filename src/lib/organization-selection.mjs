/**
 * Resolve a previously selected organization without silently choosing among
 * multiple active memberships.
 *
 * @template T
 * @param {T[]} organizations
 * @param {string | null | undefined} storedOrganizationId
 * @returns {{ selected: T | null, requiresSelection: boolean }}
 */
export function selectActiveOrganization(organizations, storedOrganizationId) {
  if (!Array.isArray(organizations) || organizations.length === 0) {
    return { selected: null, requiresSelection: false };
  }

  const storedSelection = storedOrganizationId
    ? organizations.find((item) => item.organization_id === storedOrganizationId) || null
    : null;

  if (storedSelection) {
    return { selected: storedSelection, requiresSelection: false };
  }

  if (organizations.length === 1) {
    return { selected: organizations[0], requiresSelection: false };
  }

  return { selected: null, requiresSelection: true };
}
