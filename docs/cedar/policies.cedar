// ============================================================================
// Plataforma de Donaciones Seguras — Políticas Cedar (HU-12)
// Reescritura declarativa de las reglas de autorización de HU-04, HU-07 y HU-08
// Responsable: Paolo Ramírez (Identidad y Seguridad Zero Trust)
// ============================================================================

// 1. Defensa en profundidad: prohibir cualquier acción sin un Access Token válido
forbid (
  principal,
  action,
  resource
) unless {
  context.hasValidAccessToken
};

// 2. HU-08 / HU-04 (T03): Solo rol GESTOR con scope api/projects.write crea o publica proyectos
permit (
  principal,
  action in [
    DonacionesSeguras::Action::"createProject",
    DonacionesSeguras::Action::"publishProject"
  ],
  resource
) when {
  principal.roles.contains("GESTOR") &&
  context.scopes.contains("api/projects.write")
};

// 3. HU-04 / HU-05 (T12): Solo rol DONANTE con scope api/donations.* registra donaciones
permit (
  principal,
  action == DonacionesSeguras::Action::"createDonation",
  resource
) when {
  principal.roles.contains("DONANTE") &&
  (context.scopes.contains("api/donations.*") || context.scopes.contains("api/donations.create"))
};

// 4. HU-07 / CA-07.2 (T09, T12): Un DONANTE solo consulta su propio historial (sub == ownerSub)
permit (
  principal,
  action == DonacionesSeguras::Action::"listOwnDonations",
  resource
) when {
  principal.roles.contains("DONANTE") &&
  (context.scopes.contains("api/donations.*") || context.scopes.contains("api/donations.read")) &&
  principal.sub == context.requestedOwnerSub &&
  principal.sub == resource.ownerSub
};

// 5. HU-04 / HU-06 / CA-07.2 (T09): Solo el DONANTE propietario puede simular en stage academic
permit (
  principal,
  action == DonacionesSeguras::Action::"simulateDonation",
  resource
) when {
  principal.roles.contains("DONANTE") &&
  (context.scopes.contains("api/donations.*") || context.scopes.contains("api/donations.create")) &&
  principal.sub == resource.ownerSub &&
  context.stage == "academic"
};

// 6. Prohibición explícita de acceso cruzado sobre recursos con propietario distinto (T09)
forbid (
  principal,
  action in [
    DonacionesSeguras::Action::"listOwnDonations",
    DonacionesSeguras::Action::"simulateDonation"
  ],
  resource
) when {
  resource has ownerSub &&
  resource.ownerSub != principal.sub
};
