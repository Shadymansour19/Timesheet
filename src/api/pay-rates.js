import { supabase } from '../supabase.js';

const PAY_RATE_COLS = 'level,department_id,position,x_pay_rate,y_pay_rate,trip_pay_rate,overtime_hour_rate';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function fetchPayRate(level, departmentId, position) {
  const { data, error } = await supabase
    .from('pay_rates')
    .select(PAY_RATE_COLS)
    .eq('level', level)
    .eq('department_id', departmentId)
    .eq('position', position)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchDepartmentPayRates(departmentId) {
  const { data, error } = await supabase
    .from('pay_rates')
    .select(PAY_RATE_COLS)
    .eq('department_id', departmentId)
    .order('level');
  if (error) throw error;
  return data;
}

export async function createPayRate(rate) {
  return rpc('create_pay_rate', {
    p_level: rate.level,
    p_department: rate.departmentId,
    p_position: rate.position,
    p_x_rate: rate.xPayRate,
    p_y_rate: rate.yPayRate,
    p_trip_rate: rate.tripPayRate,
    p_overtime_rate: rate.overtimeHourRate,
  });
}

export async function updatePayRate(rate) {
  return rpc('update_pay_rate', {
    p_level: rate.level,
    p_department: rate.departmentId,
    p_position: rate.position,
    p_x_rate: rate.xPayRate,
    p_y_rate: rate.yPayRate,
    p_trip_rate: rate.tripPayRate,
    p_overtime_rate: rate.overtimeHourRate,
  });
}

export async function deletePayRate(rate) {
  return rpc('delete_pay_rate', {
    p_level: rate.level,
    p_department: rate.departmentId,
    p_position: rate.position,
  });
}
