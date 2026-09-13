export function resolveProductFinderAccess(role, row) {
  return {
    canUpload: role === "admin" || row?.active === true,
    canSync: row?.can_sync === true,
  }
}
