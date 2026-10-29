import { comparePeople } from '../lib/core.js';
import { supabase } from '../supabase.js';
import { fetchAll } from './timesheet.js';

async function rpc(name, args) {
  const { error } = await supabase.rpc(name, args);
  if (error) throw error;
}

export const setStatus = (uid, day, status) => rpc('set_day_status', { p_user: uid, p_day: day, p_status: status });
// Exact cells in ONE transaction (bulk fill, Undo): rows = [{ user, day, status }] (E removes). Chunked above 5000 cells.
export async function setStatusRows(rows) {
  for (let i = 0; i < rows.length; i += 5000) await rpc('set_day_status_rows', { p_rows: rows.slice(i, i + 5000) });
}
export const setStatusBulk = (users, days, status) => rpc('set_day_status_bulk', { p_users: users, p_days: days, p_status: status });
export const setOvertime = (uid, day, hours, note) => rpc('set_overtime', { p_user: uid, p_day: day, p_hours: hours, p_note: note || null });
// One transaction for a whole day: rows = [{ user, hours (0-24 integer, 0 removes), note }]. All succeed or none do.
export const setOvertimeBulk = (day, rows) => supabase.rpc('set_overtime_bulk', { p_day: day, p_rows: rows }).then(({ error }) => { if (error) throw error; });
export const setHoliday = (day, on) => rpc('set_holiday', { p_day: day, p_on: on });
// jobTitle / contractNo / workLocation / residence ('inside' | 'outside' the work-location city) / fullNameAr (the name in Arabic, for the overtime form): text to set ('' clears); null leaves unchanged
export const updateProfile = (uid, fullName, opr, level, jobTitle = null, contractNo = null, workLocation = null, residence = null, position = null, payroll = null, yAllowed = null, fullNameAr = null) =>
  rpc('update_profile', { p_user: uid, p_full_name: fullName, p_opr: opr, p_level: level, p_job_title: jobTitle, p_contract_no: contractNo, p_work_location: workLocation, p_residence: residence, p_position: position, p_payroll: payroll, p_y_allowed: yAllowed, p_full_name_ar: fullNameAr });
// department print settings: report = { dept_print_name?, location? } (replaced as a whole); code / sector / field / nameAr / sectorAr are columns ('' clears, null keeps).
// sector = the sector value only ("Maintenance"): the exports add the word "Sector"; nameAr / sectorAr are the Arabic department name and sector of the overtime form
export const setDepartmentReport = (id, report, { code = null, sector = null, field = null, approvedEngineer = null, approvedTech = null, nameAr = null, sectorAr = null } = {}) =>
  rpc('set_department_report', { p_dept: id, p_report: report, p_code: code, p_sector: sector, p_field: field, p_approved_engineer: approvedEngineer, p_approved_tech: approvedTech, p_name_ar: nameAr, p_sector_ar: sectorAr });
export const updateSuperUser = (uid, fullName, opr) => rpc('update_super_user', { p_user: uid, p_full_name: fullName, p_opr: opr });
export const setUserRole = (uid, role) => rpc('set_user_role', { p_user: uid, p_role: role });
export const createDepartment = (name) => rpc('create_department', { p_name: name });
export const renameDepartment = (id, name) => rpc('rename_department', { p_id: id, p_name: name });

const PEOPLE_COLS = 'id,username,full_name,full_name_ar,opr,level,role,department_id,job_title,contract_no,work_location,residence,position,payroll,y_allowed';

export const fetchDeptPeople = (deptId) => fetchAll(() =>
  supabase.from('profiles').select(PEOPLE_COLS).eq('active', true).eq('department_id', deptId).order('full_name').order('id')).then((r) => r.sort(comparePeople));   // engineers, techs, ... payroll number order

// super_admin only (RLS): every active admin/user with their department.
// the people who have a timesheet (department managers do not)
export const fetchTimesheetPeople = (deptId) => fetchDeptPeople(deptId).then((r) => r.filter((p) => p.role !== 'manager'));

export const fetchAllPeople = () => fetchAll(() =>
  supabase.from('profiles').select(PEOPLE_COLS).eq('active', true).order('full_name').order('id')).then((r) => r.sort(comparePeople));

// super admins and super managers (no department); super_admin only (RLS)
export const fetchSuperUsers = () => fetchAll(() =>
  supabase.from('profiles').select(PEOPLE_COLS).eq('active', true).is('department_id', null).order('full_name').order('id'));

export async function fetchDepartments() {
  const { data, error } = await supabase.from('departments').select('id,name,name_ar,code,sector,sector_ar,field,report,approved_engineer,approved_tech').order('name');
  if (error) throw error;
  return data;
}

export async function fetchDepartment(id) {
  const { data, error } = await supabase.from('departments').select('id,name,name_ar,report,code,sector,sector_ar,field,approved_engineer,approved_tech').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// admin-manage-users Edge Function. Throws an Error carrying the HTTP status.
export async function callFn(action, payload) {
  const { data, error } = await supabase.functions.invoke('admin-manage-users', { body: { action, ...payload } });
  if (!error) return data;
  let status = 500, message = error.message;
  try { status = error.context.status; message = (await error.context.json()).error ?? message; } catch { /* network error */ }
  throw Object.assign(new Error(message), { status });
}
