-- Ensure the first-user bootstrap cannot create multiple Super-Admin accounts concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_superadmin
  ON users(role)
  WHERE role = 'superadmin';
