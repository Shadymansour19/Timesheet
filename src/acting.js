// A super admin can ACT AS the admin of any department. The chosen department is sent with every data request as the header
// "x-acting-dept" (see src/supabase.js); the database only honours it for a real super admin (migration 13).
// The Departments tab (department / admin management) runs WITHOUT the header: `active` is switched per route in router.js.
const KEY = 'ts.actingDept';
const read = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

export const acting = { dept: read(), name: '', list: [], active: false };

export function setActing(id) {
  acting.dept = id;
  acting.name = acting.list.find((d) => d.id === id)?.name ?? '';
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Load the department list and make sure a valid department is selected (the saved one, else the first by name).
export async function ensureActing(fetchDepartments) {
  acting.list = await fetchDepartments();
  const ok = acting.list.find((d) => d.id === acting.dept) ?? acting.list[0] ?? null;
  setActing(ok ? ok.id : null);
  return acting.dept;
}
