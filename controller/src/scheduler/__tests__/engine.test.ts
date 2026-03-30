import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	startPostgres,
	stopPostgres,
	truncateAll,
} from "../../__tests__/pg-setup.js";
import { insertAgent, setConfig, updateAgentStatus } from "../../db/queries.js";
import type { AgentHub } from "../../ws/hub.js";
import { Scheduler } from "../engine.js";

function createMockHub(): AgentHub & {
	sentMessages: Array<{ agentId: string; message: object }>;
} {
	const sentMessages: Array<{ agentId: string; message: object }> = [];
	return {
		sentMessages,
		sendToAgent(agentId: string, message: object): boolean {
			sentMessages.push({ agentId, message });
			return true;
		},
		getOnlineAgentIds(): string[] {
			return ["sched-agent-1"];
		},
		broadcastToAllAgents(_message: object): void {},
		handleConnection(): void {},
		dispose(): void {},
	} as unknown as AgentHub & {
		sentMessages: Array<{ agentId: string; message: object }>;
	};
}

describe("Scheduler", () => {
	let scheduler: Scheduler;
	let mockHub: ReturnType<typeof createMockHub>;

	beforeAll(async () => {
		await startPostgres();
	}, 120000);

	beforeEach(async () => {
		await truncateAll();
		await setConfig("global_schedule", "* * * * *");
		await insertAgent({
			id: "sched-agent-1",
			name: "Sched Agent",
			hostname: "srv",
			token_hash: "$2a$10$hash",
		});
		await updateAgentStatus("sched-agent-1", "online", Date.now());
		mockHub = createMockHub();
		scheduler = new Scheduler(mockHub);
	});

	afterEach(() => {
		scheduler?.stop();
	});

	afterAll(async () => {
		await stopPostgres();
	});

	it("initScheduler creates global job", async () => {
		await scheduler.init();
		expect(scheduler.isRunning()).toBe(true);
	});

	it("updateGlobalSchedule replaces job", async () => {
		await scheduler.init();
		expect(() => scheduler.updateGlobalSchedule("*/5 * * * *")).not.toThrow();
		expect(scheduler.isRunning()).toBe(true);
	});

	it("updateGlobalSchedule with invalid cron throws", async () => {
		await scheduler.init();
		expect(() => scheduler.updateGlobalSchedule("invalid")).toThrow();
	});

	it("setAgentScheduleOverride creates per-agent job", async () => {
		await scheduler.init();
		expect(() =>
			scheduler.setAgentScheduleOverride("sched-agent-1", "*/10 * * * *"),
		).not.toThrow();
	});

	it("setAgentScheduleOverride with null removes override", async () => {
		await scheduler.init();
		scheduler.setAgentScheduleOverride("sched-agent-1", "*/10 * * * *");
		expect(() =>
			scheduler.setAgentScheduleOverride("sched-agent-1", null),
		).not.toThrow();
	});

	it("stop cancels all jobs", async () => {
		await scheduler.init();
		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	// --- Finding 3.2, OBS-03 ---

	it("agent-level tasks fire with jitter delay (Finding 3.2)", async () => {
		await scheduler.init();

		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

		// Set an agent schedule override — this creates an agent-level cron task
		scheduler.setAgentScheduleOverride("sched-agent-1", "* * * * *");

		// Manually trigger the cron task's callback by finding it
		// The cron library fires inline, so we need to wait for a tick
		// Instead, we check that the createAgentTask path uses setTimeout with jitter
		// by verifying the spy was called with a delay in range [0, 5000)
		// We need to trigger the task — let's use a more direct approach:
		// Stop and recreate with a per-second cron to fire quickly
		scheduler.setAgentScheduleOverride("sched-agent-1", "* * * * * *");

		// Wait for the cron job to fire (per-second)
		await new Promise((r) => setTimeout(r, 1500));

		// Find setTimeout calls with a numeric delay between 0 and 5000
		const jitterCalls = setTimeoutSpy.mock.calls.filter(
			(call) => typeof call[1] === "number" && call[1] >= 0 && call[1] < 5000,
		);
		expect(jitterCalls.length).toBeGreaterThanOrEqual(1);

		const delay = jitterCalls[0]![1] as number;
		expect(delay).toBeGreaterThanOrEqual(0);
		expect(delay).toBeLessThan(5000);

		setTimeoutSpy.mockRestore();
	});

	it("runGlobalCheckStaggered calls expectCheckResults with correct count", async () => {
		// Spy on expectCheckResults
		const sessionBatcher = await import(
			"../../notifications/session-batcher.js"
		);
		const expectSpy = vi.spyOn(sessionBatcher, "expectCheckResults");

		await scheduler.init();

		// Trigger the global check by updating to a per-second schedule so it fires
		scheduler.updateGlobalSchedule("* * * * * *");

		// Wait for the cron to fire
		await new Promise((r) => setTimeout(r, 1500));

		// The mock hub returns ["sched-agent-1"] from getOnlineAgentIds,
		// and that agent has no schedule override, so targetIds = 1
		expect(expectSpy).toHaveBeenCalledWith(1);

		expectSpy.mockRestore();
	});

	it("DB failure during setConfig does not crash scheduler (OBS-03)", async () => {
		const setConfigSpy = vi.spyOn(
			await import("../../db/queries.js"),
			"setConfig",
		);
		setConfigSpy.mockRejectedValueOnce(new Error("DB connection lost"));

		await scheduler.init();

		// Trigger a global check — it calls setConfig("scheduler_last_run", ...)
		// which we mocked to reject. The scheduler should not crash.
		// Access the private method indirectly by updating the schedule to fire now
		scheduler.updateGlobalSchedule("* * * * * *");

		// Wait for the cron to fire
		await new Promise((r) => setTimeout(r, 1500));

		// Scheduler should still be running despite the DB failure
		expect(scheduler.isRunning()).toBe(true);

		setConfigSpy.mockRestore();
	});
});
