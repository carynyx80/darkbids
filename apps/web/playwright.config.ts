import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	workers: 1,
	use: {
		browserName: "chromium",
		launchOptions: process.env.VEIL_CHROMIUM_EXECUTABLE
			? { executablePath: process.env.VEIL_CHROMIUM_EXECUTABLE }
			: undefined,
	},
});
