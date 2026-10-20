// admin-manage-users: create users, reset passwords, delete users.
//
// Authorisation lives in the database. For every action we first call an RPC with the CALLER's
// JWT (assert_can_create / assert_can_manage / soft_delete_user), which enforces role and
// department rules. Only then do we use the service-role client for auth.users work.
// Deploy manually: supabase functions deploy admin-manage-users

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const EMAIL_DOMAIN = "timesheet.local";
const BAN = "876000h"; // ~100 years

const str = (v: unknown, name: string, max = 200) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new HttpError(400, `invalid ${name}`);
  return v.trim();
};
const uuid = (v: unknown, name: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, `invalid ${name}`);
  return v;
};
const password = (v: unknown) => {
  if (typeof v !== "string" || v.length < 8 || v.length > 72) {
    throw new HttpError(400, "password must be 8-72 characters");
  }
  return v;
};

// Map a Postgres error from an RPC to an HTTP error.
function rpcError(error: { code?: string; message: string }): HttpError {
  if (error.code === "42501") return new HttpError(403, "not authorized");
  if (error.code === "22023" || error.code === "23505" || error.code === "23514") {
    return new HttpError(400, error.message);
  }
  console.error("rpc error", error.code, error.message);
  return new HttpError(500, "internal error");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new HttpError(401, "missing token");

    // Client acting AS THE CALLER: RLS and the RPC checks see the real user.
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: who, error: whoErr } = await caller.auth.getUser();
    if (whoErr || !who.user) throw new HttpError(401, "invalid token");

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "invalid JSON");
    }

    switch (body.action) {
      case "create_user": {
        const username = str(body.username, "username", 32).toLowerCase();
        if (!USERNAME.test(username)) throw new HttpError(400, "username must be 3-32 of a-z 0-9 . _ -");
        const pw = password(body.password);
        const fullName = str(body.full_name, "full_name");
        const opr = str(body.opr, "opr", 50);
        const level = body.level === null || body.level === undefined ? null : Number(body.level);
        if (level !== null && (!Number.isInteger(level) || level < 0)) throw new HttpError(400, "invalid level");
        const optional = (v: unknown, name: string, max: number) => {   // optional free text, '' / missing = none
          if (v === null || v === undefined || v === "") return null;
          if (typeof v !== "string" || v.length > max) throw new HttpError(400, `invalid ${name}`);
          return v.trim() || null;
        };
        const jobTitle = optional(body.job_title, "job_title", 100);
        const contractNo = optional(body.contract_no, "contract_no", 50);
        const workLocation = optional(body.work_location, "work_location", 100);
        const residence = optional(body.residence, "residence", 20);
        const position = optional(body.position, "position", 100);
        if (residence !== null && residence !== "inside" && residence !== "outside") throw new HttpError(400, "residence must be inside or outside");
        const deptId = uuid(body.department_id, "department_id");
        const role = str(body.role ?? "user", "role", 20);

        const { error: authzErr } = await caller.rpc("assert_can_create", { p_dept: deptId, p_role: role });
        if (authzErr) throw rpcError(authzErr);

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: `${username}@${EMAIL_DOMAIN}`,
          password: pw,
          email_confirm: true,
        });
        if (createErr || !created.user) {
          if (createErr?.status === 422 || /already/i.test(createErr?.message ?? "")) {
            throw new HttpError(409, "username already exists");
          }
          console.error("createUser", createErr?.message);
          throw new HttpError(500, "could not create user");
        }

        const { error: profErr } = await admin.from("profiles").insert({
          id: created.user.id,
          username,
          full_name: fullName,
          opr,
          level,
          department_id: deptId,
          role,
          job_title: jobTitle,
          contract_no: contractNo,
          work_location: workLocation,
          residence,
          position,
        });
        if (profErr) {
          await admin.auth.admin.deleteUser(created.user.id); // roll back the auth user
          if (profErr.code === "23505") throw new HttpError(409, "username or OPR already exists");
          console.error("profile insert", profErr.code, profErr.message);
          throw new HttpError(400, "could not create profile");
        }
        return json(200, { id: created.user.id, username });
      }

      case "reset_password": {
        const target = uuid(body.user_id, "user_id");
        const pw = password(body.password);
        const { error: authzErr } = await caller.rpc("assert_can_manage", { p_target: target, p_action: "reset" });
        if (authzErr) throw rpcError(authzErr);
        const { error } = await admin.auth.admin.updateUserById(target, { password: pw });
        if (error) {
          console.error("updateUserById", error.message);
          throw new HttpError(500, "could not reset password");
        }
        return json(200, { ok: true });
      }

      case "delete_user": {
        const target = uuid(body.user_id, "user_id");
        const { error: delErr } = await caller.rpc("soft_delete_user", { p_user: target });
        if (delErr) throw rpcError(delErr);
        // Profile is now inactive (RLS locks the user out); also ban so they cannot sign in at all.
        const { error } = await admin.auth.admin.updateUserById(target, { ban_duration: BAN });
        if (error) {
          console.error("ban", error.message);
          throw new HttpError(500, "user deactivated but ban failed");
        }
        return json(200, { ok: true });
      }

      default:
        throw new HttpError(400, "unknown action");
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "internal error" });
  }
});
