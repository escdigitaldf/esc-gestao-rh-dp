-- btree_gist is relocatable and is not referenced by application indexes
-- or exclusion constraints in this project. Keep extensions outside public.
alter extension btree_gist set schema extensions;
