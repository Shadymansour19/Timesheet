-- One-off data fix: some people were entered with the two fields the wrong way round (Position = Supervisor / Superintendent /
-- Certified Rigger ..., Job title = Engineer / Tech). Where Position is neither engineer nor tech but the Job title is, swap them.
-- (In an UPDATE the right-hand sides see the OLD values, so this is a real swap.)
update public.profiles
   set "position" = job_title, job_title = "position"
 where role <> 'super_admin'
   and coalesce("position", '') !~* '(engineer|tech)'
   and coalesce(job_title, '') ~* '(engineer|tech)';
