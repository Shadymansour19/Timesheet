-- OPR and payroll are free text (EMC-123, OPRCTR123, OPR123 ...). One-off backfill of the existing people: payroll gets the
-- prefix "EMC-", OPR gets "OPRCTR" (when not already prefixed). Reports print the values exactly as stored.
update public.profiles set payroll = 'EMC-' || payroll where payroll is not null and payroll <> '' and payroll not like 'EMC-%';
update public.profiles set opr = 'OPRCTR' || opr where opr is not null and opr <> '' and opr not like 'OPRCTR%';
