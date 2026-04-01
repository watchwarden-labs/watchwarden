import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/api/hooks/useAgents";
import { useStore } from "@/store/useStore";
import { ContainerRow } from "../agents/ContainerRow";

const baseContainer: Container = {
	id: "c-1",
	agent_id: "agent-1",
	docker_id: "d-1",
	name: "nginx",
	image: "nginx:latest",
	current_digest: "sha256:abc123def456",
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
	policy: null,
	tag_pattern: null,
	update_level: null,
};

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

function renderInTable(ui: React.ReactElement) {
	return render(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	);
}

describe("ContainerRow", () => {
	it("renders container name and image", () => {
		renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
		expect(screen.getByText("nginx")).toBeInTheDocument();
		expect(screen.getByText("nginx:latest")).toBeInTheDocument();
	});

	it("shows Update button when hasUpdate is true", () => {
		renderInTable(
			<ContainerRow
				agentId="agent-1"
				container={{ ...baseContainer, has_update: 1 }}
			/>,
		);
		expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
	});

	it("hides Update button when hasUpdate is false", () => {
		renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
		expect(
			screen.queryByRole("button", { name: "Update" }),
		).not.toBeInTheDocument();
	});

	it("shows Rollback button for non-pinned container", () => {
		renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
		expect(
			screen.getByRole("button", { name: "Rollback" }),
		).toBeInTheDocument();
	});

	it("hides Rollback button for pinned container but shows Stop", () => {
		renderInTable(
			<ContainerRow
				agentId="agent-1"
				container={{ ...baseContainer, pinned_version: 1 }}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "Rollback" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
	});

	it("shows Stop button for running container", () => {
		renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
		expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
	});

	it("shows Start button for exited container", () => {
		renderInTable(
			<ContainerRow
				agentId="agent-1"
				container={{ ...baseContainer, status: "exited" }}
			/>,
		);
		expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
	});

	it("shows step indicator when updateProgress exists", () => {
		useStore.setState({
			updateProgress: {
				"agent-1:d-1": {
					step: "pulling",
					containerName: "nginx",
					timestamp: Date.now(),
				},
			},
		});
		renderInTable(<ContainerRow agentId="agent-1" container={baseContainer} />);
		expect(screen.getByText("pulling")).toBeInTheDocument();
		useStore.setState({ updateProgress: {} });
	});

	it("click Update calls onUpdate", () => {
		const onUpdate = vi.fn();
		renderInTable(
			<ContainerRow
				agentId="agent-1"
				container={{ ...baseContainer, has_update: 1 }}
				onUpdate={onUpdate}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Update" }));
		expect(onUpdate).toHaveBeenCalledOnce();
	});
});
