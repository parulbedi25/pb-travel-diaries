/** Finite task for cPanel's Run JS Script: checks files; never starts a server. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  for (const file of ["app.cjs", "dist/index.html", "server/index.js"]) {
    if (!fs.existsSync(path.join(root, file))) {
      throw new Error(`${file} is missing. Upload the complete folder produced by npm run package.`);
    }
  }
  for (const name of ["express", "mysql2", "bcryptjs", "dotenv", "multer", "cookie-parser", "yauzl", "yazl"]) {
    await import(name);
  }
  for (const name of ["data", "media", "backup", "server/data"]) {
    const folder = path.join(root, name);
    fs.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, `.hosting-check-${process.pid}`);
    fs.writeFileSync(probe, "ok", { flag: "wx", mode: 0o600 });
    fs.unlinkSync(probe);
  }
  console.log("Hosting files, dependencies and writable folders: OK.");
  console.log("Startup file: app.cjs. Use cPanel Start/Restart, then open your domain to finish database/owner setup.");
  console.log("This check does not test database credentials or start another web process.");
} catch (error) {
  console.error(`[hosting-check] ${error.message}`);
  console.error("If a package is missing, use Run NPM Install first.");
  process.exitCode = 1;
}
