import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "../common/StatusDot";

describe("StatusDot", () => {
	it("renders green dot for online status", () => {
		render(<StatusDot status="online" />);
		const dot = screen.getByTestId("status-dot");
		expect(dot).toHaveAttribute("data-status", "online");
		expect(dot.className).toContain("bg-success");
		expect(dot.className).toContain("animate-pulse-green");
	});

	it("renders gray dot for offline status", () => {
		render(<StatusDot status="offline" />);
		const dot = screen.getByTestId("status-dot");
		expect(dot).toHaveAttribute("data-status", "offline");
		expect(dot.className).toContain("bg-muted-foreground");
	});

	it("renders blue spinner for updating status", () => {
		render(<StatusDot status="updating" />);
		const dot = screen.getByTestId("status-dot");
		expect(dot).toHaveAttribute("data-status", "updating");
		expect(dot.className).toContain("bg-primary");
		expect(dot.className).toContain("animate-spin");
	});
});
