-- ============================================================
-- KITOM v2.2 · 26 · STORAGE: BUCKETS Y POLÍTICAS
-- CAMBIO vs v2.1 (punto 14, auditoría completa por bucket):
--   - reminder-attachments: le faltaba la policy de DELETE que sí
--     tenían pet-photos y avatars (inconsistencia detectada en esta
--     auditoría, sin relación con ningún punto numerado concreto del
--     documento, pero cubierta por "haz una auditoría completa de
--     todas las tablas/Storage"). Un editor puede borrar el adjunto
--     de un recordatorio de una mascota a la que tiene acceso.
--   - Confirmado (sin cambios): ningún bucket concede UPDATE — no
--     hace falta, se borra y se vuelve a subir si hace falta
--     reemplazar un archivo, más simple que soportar sobrescritura.
--   - Todos los buckets siguen siendo privados; todas las policies de
--     los 3 buckets de mascota siguen usando safe_pet_id_from_path().
-- ============================================================
insert into storage.buckets (id, name, public) values ('pet-photos', 'pet-photos', false);
insert into storage.buckets (id, name, public) values ('reminder-attachments', 'reminder-attachments', false);
insert into storage.buckets (id, name, public) values ('shared-reports', 'shared-reports', false);
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);

-- pet-photos: select/insert/delete para miembros/editores
create policy "pet-photos: select members" on storage.objects for select using (
  bucket_id = 'pet-photos' and public.is_pet_member(public.safe_pet_id_from_path(name))
);
create policy "pet-photos: insert editors" on storage.objects for insert with check (
  bucket_id = 'pet-photos' and public.can_edit_pet(public.safe_pet_id_from_path(name))
);
create policy "pet-photos: delete editors" on storage.objects for delete using (
  bucket_id = 'pet-photos' and public.can_edit_pet(public.safe_pet_id_from_path(name))
);

-- reminder-attachments: select/insert/delete (delete añadido en v2.2)
create policy "reminder-attachments: select members" on storage.objects for select using (
  bucket_id = 'reminder-attachments' and public.is_pet_member(public.safe_pet_id_from_path(name))
);
create policy "reminder-attachments: insert editors" on storage.objects for insert with check (
  bucket_id = 'reminder-attachments' and public.can_edit_pet(public.safe_pet_id_from_path(name))
);
create policy "reminder-attachments: delete editors" on storage.objects for delete using (
  bucket_id = 'reminder-attachments' and public.can_edit_pet(public.safe_pet_id_from_path(name))
);

-- shared-reports: solo select (insert/delete son 100% backend/service_role)
create policy "shared-reports: select members" on storage.objects for select using (
  bucket_id = 'shared-reports' and public.is_pet_member(public.safe_pet_id_from_path(name))
);

-- avatars: privado, ruta {user_id}/{archivo}, solo el propio dueño
create policy "avatars: owner read" on storage.objects for select using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatars: owner insert" on storage.objects for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatars: owner delete" on storage.objects for delete using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
