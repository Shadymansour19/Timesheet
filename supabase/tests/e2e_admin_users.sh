#!/usr/bin/env bash
# End-to-end test of the DEPLOYED admin-manage-users function.
# Needs: TS_DB_URL (env, e.g. `set -a; . ./.env.db; set +a`), VITE_SUPABASE_URL and
# VITE_SUPABASE_ANON_KEY (read from .env.local), curl, jq, psql.
# Creates temporary e2e_* users + a department directly in the DB, exercises the function over HTTP,
# then deletes everything it created (also on failure).
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${TS_DB_URL:?TS_DB_URL not set}"
URL=$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2-)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)
FN="$URL/functions/v1/admin-manage-users"
PW='E2e-Test-Pass-1'
DEPT_A=20000000-0000-0000-0000-00000000000a
DEPT_B=20000000-0000-0000-0000-00000000000b
SA=20000000-0000-0000-0000-0000000000a0
ADM=20000000-0000-0000-0000-0000000000a1
fail=0

sql() { psql "$TS_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

cleanup() {
  sql "delete from public.audit_log where department_id in ('$DEPT_A','$DEPT_B') or actor in ('$SA','$ADM')
       or target_user in (select id from public.profiles where username like 'e2e%');
       delete from auth.users where email like 'e2e%@timesheet.local';
       delete from public.departments where id in ('$DEPT_A','$DEPT_B');
       delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments)) or (table_name = 'departments' and new_value like 'E2E %');" >/dev/null
}
trap cleanup EXIT
cleanup # in case a previous run died

mkuser() { # id username role dept
  sql "insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
         raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
         email_change_token_new,email_change)
       values ('00000000-0000-0000-0000-000000000000','$1','authenticated','authenticated','$2@timesheet.local',
         crypt('$PW', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',now(),now(),'','','','');
       insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
       values (gen_random_uuid(),'$1','$1',json_build_object('sub','$1','email','$2@timesheet.local'),'email',now(),now(),now());
       insert into public.profiles (id,username,full_name,opr,level,department_id,role)
       values ('$1','$2','$2 name',$( [ "$3" = super_admin ] && echo null || echo "'OPR-$2'" ),1,$( [ "$3" = super_admin ] && echo null || echo "'$4'" ),'$3');" >/dev/null
}

login() { # username password -> access token or empty
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1@timesheet.local\",\"password\":\"$2\"}" | jq -r '.access_token // empty'
}

call() { # token json -> sets CODE and BODY
  local out
  out=$(curl -s -w '\n%{http_code}' -X POST "$FN" -H "apikey: $KEY" ${1:+-H "Authorization: Bearer $1"} \
    -H 'Content-Type: application/json' -d "$2")
  CODE=${out##*$'\n'}; BODY=${out%$'\n'*}
}

check() { # label expected_code
  if [ "$CODE" = "$2" ]; then echo "PASS: $1 (HTTP $CODE)"; else echo "FAIL: $1 -- expected $2, got $CODE: $BODY"; fail=1; fi
}
expect() { # label actual expected
  if [ "$2" = "$3" ]; then echo "PASS: $1 (= $2)"; else echo "FAIL: $1 -- expected '$3', got '$2'"; fail=1; fi
}

sql "insert into public.departments (id,name) values ('$DEPT_A','E2E A'),('$DEPT_B','E2E B');" >/dev/null
mkuser "$SA"  e2e_sa  super_admin ""
mkuser "$ADM" e2e_adm admin "$DEPT_A"
ADM_T=$(login e2e_adm "$PW"); SA_T=$(login e2e_sa "$PW")
[ -n "$ADM_T" ] && [ -n "$SA_T" ] || { echo "FAIL: could not log in fixture users"; exit 1; }
echo "PASS: fixture users can log in"

# ---- anonymous / bad input
call "" '{"action":"create_user"}';                                  check "no token rejected" 401
call "garbage" '{"action":"create_user"}';                           check "bad token rejected" 401
call "$ADM_T" 'not json';                                            check "invalid JSON" 400
call "$ADM_T" '{"action":"nope"}';                                   check "unknown action" 400
call "$ADM_T" "{\"action\":\"create_user\",\"username\":\"e2e_u1\",\"password\":\"short\",\"full_name\":\"n\",\"opr\":\"o\",\"payroll\":\"P-o\",\"department_id\":\"$DEPT_A\"}"
check "short password rejected" 400

# ---- department admin
call "$ADM_T" "{\"action\":\"create_user\",\"username\":\"E2E_U1\",\"password\":\"$PW\",\"full_name\":\"E2E User 1\",\"opr\":\"E2E-1\",\"payroll\":\"P-E2E-1\",\"level\":3,\"department_id\":\"$DEPT_A\"}"
check "admin creates user in own dept (username lower-cased)" 200
U1=$(echo "$BODY" | jq -r .id)
expect "profile row correct" "$(sql "select username||'|'||role||'|'||opr||'|'||level||'|'||department_id||'|'||active from public.profiles where id='$U1'")" "e2e_u1|user|E2E-1|3|$DEPT_A|true"
[ -n "$(login e2e_u1 "$PW")" ] && echo "PASS: new user can log in" || { echo "FAIL: new user cannot log in"; fail=1; }
call "$ADM_T" "{\"action\":\"create_user\",\"username\":\"e2e_u1\",\"password\":\"$PW\",\"full_name\":\"dup\",\"opr\":\"E2E-9\",\"payroll\":\"P-E2E-9\",\"department_id\":\"$DEPT_A\"}"
check "duplicate username -> 409" 409
call "$ADM_T" "{\"action\":\"create_user\",\"username\":\"e2e_u9\",\"password\":\"$PW\",\"full_name\":\"dup opr\",\"opr\":\"E2E-1\",\"payroll\":\"P-E2E-1\",\"department_id\":\"$DEPT_A\"}"
check "duplicate OPR -> 409" 409
expect "failed create left no orphan auth user" "$(sql "select count(*) from auth.users where email='e2e_u9@timesheet.local'")" "0"
call "$ADM_T" "{\"action\":\"create_user\",\"username\":\"e2e_u2\",\"password\":\"$PW\",\"full_name\":\"x\",\"opr\":\"E2E-2\",\"payroll\":\"P-E2E-2\",\"department_id\":\"$DEPT_B\"}"
check "admin cannot create in other dept" 403
call "$ADM_T" "{\"action\":\"create_user\",\"username\":\"e2e_u2\",\"password\":\"$PW\",\"full_name\":\"x\",\"opr\":\"E2E-2\",\"payroll\":\"P-E2E-2\",\"department_id\":\"$DEPT_A\",\"role\":\"super_admin\"}"
check "admin cannot create a super_admin" 403
expect "no rogue users were created" "$(sql "select count(*) from auth.users where email in ('e2e_u2@timesheet.local')")" "0"

call "$ADM_T" "{\"action\":\"reset_password\",\"user_id\":\"$U1\",\"password\":\"New-Pass-12345\"}"
check "admin resets own-dept user password" 200
[ -n "$(login e2e_u1 'New-Pass-12345')" ] && echo "PASS: new password works" || { echo "FAIL: new password rejected"; fail=1; }
[ -z "$(login e2e_u1 "$PW")" ] && echo "PASS: old password no longer works" || { echo "FAIL: old password still works"; fail=1; }
call "$ADM_T" "{\"action\":\"reset_password\",\"user_id\":\"$SA\",\"password\":\"New-Pass-12345\"}"
check "admin cannot reset super_admin" 403
call "$ADM_T" "{\"action\":\"delete_user\",\"user_id\":\"$ADM\"}"
check "admin cannot delete self" 403

U1_T=$(login e2e_u1 'New-Pass-12345')
call "$U1_T" "{\"action\":\"create_user\",\"username\":\"e2e_u3\",\"password\":\"$PW\",\"full_name\":\"x\",\"opr\":\"E2E-3\",\"payroll\":\"P-E2E-3\",\"department_id\":\"$DEPT_A\"}"
check "plain user cannot create users" 403
call "$U1_T" "{\"action\":\"reset_password\",\"user_id\":\"$ADM\",\"password\":\"New-Pass-12345\"}"
check "plain user cannot reset passwords" 403
call "$U1_T" "{\"action\":\"delete_user\",\"user_id\":\"$ADM\"}"
check "plain user cannot delete" 403

# ---- super admin
call "$SA_T" "{\"action\":\"create_user\",\"username\":\"e2e_u4\",\"password\":\"$PW\",\"full_name\":\"x\",\"opr\":\"E2E-4\",\"payroll\":\"P-E2E-4\",\"department_id\":\"$DEPT_A\"}"
check "super_admin cannot create plain user" 403
call "$SA_T" "{\"action\":\"create_user\",\"username\":\"e2e_adm2\",\"password\":\"$PW\",\"full_name\":\"Admin Two\",\"opr\":\"E2E-A2\",\"payroll\":\"P-E2E-A2\",\"department_id\":\"$DEPT_B\",\"role\":\"admin\"}"
check "super_admin creates admin in dept B" 200
ADM2=$(echo "$BODY" | jq -r .id)
expect "admin profile role/dept" "$(sql "select role||'|'||department_id from public.profiles where id='$ADM2'")" "admin|$DEPT_B"
call "$SA_T" "{\"action\":\"reset_password\",\"user_id\":\"$ADM2\",\"password\":\"New-Pass-12345\"}"
check "super_admin resets an admin password" 200
call "$SA_T" "{\"action\":\"reset_password\",\"user_id\":\"$U1\",\"password\":\"New-Pass-12345\"}"
check "super_admin cannot reset a plain user" 403
call "$SA_T" "{\"action\":\"delete_user\",\"user_id\":\"$U1\"}"
check "super_admin cannot delete a plain user" 403

# ---- deletion
call "$SA_T" "{\"action\":\"delete_user\",\"user_id\":\"$ADM2\"}"
check "super_admin deletes an admin" 200
[ -z "$(login e2e_adm2 'New-Pass-12345')" ] && echo "PASS: deleted admin cannot log in (banned)" || { echo "FAIL: deleted admin can still log in"; fail=1; }
expect "deleted admin profile inactive" "$(sql "select active||'|'||(deleted_at is not null) from public.profiles where id='$ADM2'")" "false|true"
call "$ADM_T" "{\"action\":\"delete_user\",\"user_id\":\"$U1\"}"
check "admin deletes own-dept user" 200
[ -z "$(login e2e_u1 'New-Pass-12345')" ] && echo "PASS: deleted user cannot log in" || { echo "FAIL: deleted user can still log in"; fail=1; }
call "$ADM_T" "{\"action\":\"reset_password\",\"user_id\":\"$U1\",\"password\":\"New-Pass-12345\"}"
check "cannot reset a deleted user" 403

[ "$fail" = 0 ] && echo "=== ALL E2E TESTS PASSED ===" || { echo "=== E2E FAILURES ==="; exit 1; }
