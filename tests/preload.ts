// Runs before any test file imports lib/prisma, so the Prisma client
// connects to the test database instead of the main DATABASE_URL.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
