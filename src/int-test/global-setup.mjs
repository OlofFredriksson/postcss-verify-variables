import { execSync } from "node:child_process";

export default function setup() {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Uses the same npm command as the package scripts.
    execSync("npm run build", { stdio: "inherit" });
}
