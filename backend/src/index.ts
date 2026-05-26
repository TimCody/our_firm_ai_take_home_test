// Must be the first import. Populates process.env before any other
// module evaluates (some modules read env vars at module-load time).
import "./load-env.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
const app = createServer();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] listening on http://localhost:${port}`);
});
