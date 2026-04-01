import { describe, expect, it } from "vitest";
import {
	interpolateTemplate,
	parseImageComponents,
	renderImageLink,
} from "../template-helpers.js";

describe("interpolateTemplate", () => {
	it("replaces known variables", () => {
		expect(interpolateTemplate("Hello {{name}}!", { name: "World" })).toBe(
			"Hello World!",
		);
	});
	it("leaves unknown variables empty", () => {
		expect(interpolateTemplate("{{known}} {{unknown}}", { known: "yes" })).toBe(
			"yes ",
		);
	});
});

describe("parseImageComponents", () => {
	it("parses Docker Hub official image", () => {
		const c = parseImageComponents("nginx:latest");
		expect(c.registry).toBe("docker.io");
		expect(c.repository).toBe("library/nginx");
		expect(c.tag).toBe("latest");
	});
	it("parses Docker Hub user image", () => {
		const c = parseImageComponents("myuser/myapp:v1.2.3");
		expect(c.registry).toBe("docker.io");
		expect(c.repository).toBe("myuser/myapp");
		expect(c.tag).toBe("v1.2.3");
		expect(c.owner).toBe("myuser");
		expect(c.name).toBe("myapp");
	});
	it("parses GHCR image", () => {
		const c = parseImageComponents("ghcr.io/linuxserver/radarr:latest");
		expect(c.registry).toBe("ghcr.io");
		expect(c.repository).toBe("linuxserver/radarr");
		expect(c.owner).toBe("linuxserver");
		expect(c.name).toBe("radarr");
	});
	it("handles image with digest", () => {
		const c = parseImageComponents("nginx@sha256:abc123");
		expect(c.registry).toBe("docker.io");
		expect(c.tag).toBe("latest");
	});
});

describe("renderImageLink", () => {
	it("returns empty for null template", () => {
		expect(renderImageLink("nginx:latest", null)).toBe("");
	});
	it("auto-detects Docker Hub link", () => {
		const link = renderImageLink("nginx:1.25", "auto");
		expect(link).toContain("hub.docker.com");
		expect(link).toContain("library/nginx");
	});
	it("auto-detects GHCR link", () => {
		const link = renderImageLink("ghcr.io/linuxserver/radarr:latest", "auto");
		expect(link).toContain("github.com/linuxserver");
	});
	it("uses custom template", () => {
		const link = renderImageLink(
			"myuser/myapp:v1",
			"https://example.com/{{repository}}/{{tag}}",
		);
		expect(link).toBe("https://example.com/myuser/myapp/v1");
	});
});
