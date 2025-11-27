import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["favicon.ico", "mediapipe/**/*"],
			manifest: {
				name: "Magic Monitor",
				short_name: "MagicMon",
				description:
					"Real-time camera mirroring with smart zoom and instant replay",
				theme_color: "#000000",
				background_color: "#000000",
				display: "standalone",
				orientation: "landscape",
				icons: [
					{
						src: "pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,task}"],
				maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15MB for large model files
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
						handler: "CacheFirst",
						options: {
							cacheName: "google-fonts-cache",
							expiration: {
								maxEntries: 10,
								maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
							},
						},
					},
				],
			},
		}),
	],
	test: {
		environment: "jsdom",
		globals: true,
		exclude: ["tests/**", "node_modules/**"],
	},
});
