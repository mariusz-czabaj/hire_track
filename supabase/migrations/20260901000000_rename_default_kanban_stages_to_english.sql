-- Rename the six global default kanban stages from Polish to English so the
-- board renders English text, per the English-artifacts rule in
-- context/foundation/lessons.md. Data-only update keyed by sort_order;
-- touches no schema, no constraints, and no other table.
update kanban_stages set name = 'New' where recruitment_id is null and sort_order = 1;
update kanban_stages set name = 'Screening' where recruitment_id is null and sort_order = 2;
update kanban_stages set name = 'Interview' where recruitment_id is null and sort_order = 3;
update kanban_stages set name = 'Offer' where recruitment_id is null and sort_order = 4;
update kanban_stages set name = 'Hired' where recruitment_id is null and sort_order = 5;
update kanban_stages set name = 'Rejected' where recruitment_id is null and sort_order = 6;
