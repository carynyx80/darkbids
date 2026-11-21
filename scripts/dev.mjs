import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("apps/api/.env") || !existsSync("apps/web/.env.local")) {
	console.error(
		"Configure apps/api/.env and apps/web/.env.local as shown in README.md.",
	);
	process.exit(1);
}
process.loadEnvFile("apps/api/.env");

if (process.env.VEIL_EXTERNAL_POSTGRES !== "true") {
	const result = spawnSync(
		"docker",
		["compose", "up", "-d", "--wait", "postgres"],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) {
		console.error(
			"Install Docker Compose or set VEIL_EXTERNAL_POSTGRES=true with your own DATABASE_URL.",
		);
		process.exit(1);
	}
}
if (
	process.env.NEXT_PUBLIC_NETWORK === "localnet" &&
	process.env.VEIL_EXTERNAL_ZOLANA !== "true"
) {
	const result = spawnSync("zolana", ["dev", "start"], { stdio: "inherit" });
	if (result.status !== 0) {
		console.error(
			"Install zolana or set VEIL_EXTERNAL_ZOLANA=true with an existing local stack.",
		);
		process.exit(1);
	}
}
const apps = spawn("pnpm", ["-r", "--parallel", "dev"], { stdio: "inherit" });
apps.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
apps.on("exit", (status) => {
	process.exitCode = status ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => apps.kill(signal));
