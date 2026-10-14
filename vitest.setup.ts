// Hard guard: integration specs must NEVER run against the live database.
// Only connection strings targeting a *_test database are allowed.
const url = process.env.TEST_DATABASE_URL ?? "";
if (url !== "" && !/[_-]test([?&].*)?$/.test(url)) {
  throw new Error(`Refusing to run tests against non-test database: ${url.replace(/:[^:@/]+@/, ":***@")}`);
}
