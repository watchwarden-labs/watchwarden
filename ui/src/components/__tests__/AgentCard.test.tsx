import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@/api/hooks/useAgents";
import { AgentCard } from "../agents/AgentCard";

const mockAgent: Agent = {
	id: "agent-1",
	name: "Test Agent",
	hostname: "server-1.example.com",
	status: "online",
	last_seen: Date.now(),
	schedule_override: null,
	auto_update: 0,
	docker_version: null,
	docker_api_version: null,
	os: null,
	arch: null,
	created_at: Date.now(),
	containers: [
		{
			id: "c-1",
			agent_id: "agent-1",
			docker_id: "d-1",
			name: "nginx",
			image: "nginx:latest",
			current_digest: "sha256:abc",
			latest_digest: "sha256:def",
			has_update: 1,
			status: "running",
			health_status: "healthy",
			pinned_version: 0,
			excluded: 0,
			exclude_reason: null,
			update_group: null,
			update_priority: 100,
			depends_on: null,
			last_diff: null,
			last_checked: null,
			last_updated: null,
		},
		{
			id: "c-2",
			agent_id: "agent-1",
			docker_id: "d-2",
			name: "redis",
			image: "redis:7",
			current_digest: null,
			latest_digest: null,
			has_update: 0,
			status: "running",
			health_status: "healthy",
			pinned_version: 0,
			excluded: 0,
			exclude_reason: null,
			update_group: null,
			update_priority: 100,
			depends_on: null,
			last_diff: null,
			last_checked: null,
			last_updated: null,
		},
	],
};

describe("AgentCard", () => {
	it("renders agent name and hostname", () => {
		render(<AgentCard agent={mockAgent} />);
		expect(screen.getByText("Test Agent")).toBeInTheDocument();
		expect(screen.getByText("server-1.example.com")).toBeInTheDocument();
	});

	it("shows container count", () => {
		render(<AgentCard agent={mockAgent} />);
		expect(screen.getByText("2 containers")).toBeInTheDocument();
	});

	it("shows update badge when updates available", () => {
		render(<AgentCard agent={mockAgent} />);
		expect(screen.getByTestId("update-badge")).toHaveTextContent("1 update");
	});

	it("does not show update badge when no updates", () => {
		const noUpdates = {
			...mockAgent,
			containers: mockAgent.containers?.map((c) => ({ ...c, has_update: 0 })),
		};
		render(<AgentCard agent={noUpdates} />);
		expect(screen.queryByTestId("update-badge")).not.toBeInTheDocument();
	});

	it("click Check calls onCheck", () => {
		const onCheck = vi.fn();
		render(<AgentCard agent={mockAgent} onCheck={onCheck} />);
		fireEvent.click(screen.getByText("Check"));
		expect(onCheck).toHaveBeenCalledOnce();
	});

	it("click Update All calls onUpdate", () => {
		const onUpdate = vi.fn();
		render(<AgentCard agent={mockAgent} onUpdate={onUpdate} />);
		fireEvent.click(screen.getByText("Update All"));
		expect(onUpdate).toHaveBeenCalledOnce();
	});
});
