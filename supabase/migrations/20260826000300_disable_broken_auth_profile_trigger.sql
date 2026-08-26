begin;

-- O FinFlow mantém o perfil no user_metadata do auth.users. Este gatilho
-- legado de criação de profiles referencia uma estrutura que não existe mais e
-- transforma qualquer cadastro em "Database error saving new user" (500).
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists handle_new_user on auth.users;

commit;
