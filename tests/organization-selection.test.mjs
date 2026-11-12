import test from "node:test";
import assert from "node:assert/strict";
import { selectActiveOrganization } from "../src/lib/organization-selection.mjs";

const orgA = { organization_id: "org-a", role: "admin" };
const orgB = { organization_id: "org-b", role: "hr_manager" };

test("retorna seleção vazia quando usuário não possui organizações", () => {
  assert.deepEqual(selectActiveOrganization([], null), {
    selected: null,
    requiresSelection: false,
  });
});

test("seleciona automaticamente a única organização ativa", () => {
  assert.deepEqual(selectActiveOrganization([orgA], null), {
    selected: orgA,
    requiresSelection: false,
  });
});

test("mantém a organização previamente selecionada entre várias opções", () => {
  assert.deepEqual(selectActiveOrganization([orgA, orgB], "org-b"), {
    selected: orgB,
    requiresSelection: false,
  });
});

test("exige escolha explícita quando há várias organizações sem preferência salva", () => {
  assert.deepEqual(selectActiveOrganization([orgA, orgB], null), {
    selected: null,
    requiresSelection: true,
  });
});

test("não reutiliza uma seleção salva que não pertence mais às associações ativas", () => {
  assert.deepEqual(selectActiveOrganization([orgA, orgB], "org-removed"), {
    selected: null,
    requiresSelection: true,
  });
});

test("não escolhe arbitrariamente quando a lista de opções está ausente", () => {
  assert.deepEqual(selectActiveOrganization(null, "org-a"), {
    selected: null,
    requiresSelection: false,
  });
});
