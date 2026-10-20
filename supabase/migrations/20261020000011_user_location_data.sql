-- Work location is per person (profiles.work_location), not per department.
-- One-off data fix: every existing person gets "IDKU Site". NOT a column default: new people start empty.
update public.profiles set work_location = 'IDKU Site' where work_location is null;
-- The department-level location is no longer used by the report.
update public.departments set report = report - 'location' where report ? 'location';
