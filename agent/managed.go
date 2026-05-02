package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/docker/docker/api/types/container"
)

// runManagedMode starts the agent in Controller-managed mode.
// Connects via WebSocket, receives commands, and reports results.
func runManagedMode(cfg *AgentConfig, credStore *CredStore, dockerClient *DockerClient,
	updater *Updater, pruner *Pruner, scanner *Scanner, dockerVer *DockerVersionInfo) {

	localSchedule := cfg.LocalSchedule
	var scheduleMu sync.Mutex

	// Scheduler — used as fallback when controller is unreachable
	scheduler := NewLocalScheduler(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		containers, err := dockerClient.ListContainers(ctx)
		if err != nil {
			log.Printf("Local check failed: %v", err)
			return
		}
		ids := make([]string, len(containers))
		for i, c := range containers {
			ids[i] = c.DockerID
		}
		results, err := updater.CheckForUpdates(ctx, ids)
		if err != nil {
			log.Printf("Local check error: %v", err)
		}
		for _, r := range results {
			if r.HasUpdate {
				log.Printf("Update available for %s: %s -> %s", r.ContainerName, r.CurrentDigest, r.LatestDigest)
			}
		}
	})

	// WebSocket client
	wsClient := NewWSClient(WSClientConfig{
		URL:           cfg.ControllerURL + "/ws/agent",
		Token:         cfg.AgentToken,
		AgentName:     cfg.AgentName,
		DockerVersion: dockerVer,
		GetContainers: func() []ContainerInfo {
			containers, err := dockerClient.ListContainers(context.Background())
			if err != nil {
				log.Printf("Failed to list containers: %v", err)
				return nil
			}
			log.Printf("Listed %d containers", len(containers))
			return containers
		},
		OnStateChange: func(connected bool) {
			if connected {
				log.Println("Connected to controller")
				scheduler.Disable()
			} else {
				log.Println("Disconnected from controller")
				scheduleMu.Lock()
				sched := localSchedule
				if sched != "" {
					if err := scheduler.Enable(sched); err != nil {
						log.Printf("Failed to enable local schedule: %v", err)
					} else {
						log.Printf("Local schedule enabled: %s", sched)
					}
				}
				scheduleMu.Unlock()
			}
		},
	})

	// Health monitor
	healthMonitor := NewHealthMonitor(dockerClient, updater, func(msg Message) {
		wsClient.Send(msg)
	})

	// Wire progress notifications through WebSocket
	updater.SetProgressFunc(func(containerID, containerName, step, progress string) {
		wsClient.Send(Message{
			Type: "UPDATE_PROGRESS",
			Payload: map[string]interface{}{
				"containerId":   containerID,
				"containerName": containerName,
				"step":          step,
				"progress":      progress,
			},
		})
	})

	// Register all message handlers
	wsClient.OnMessage("CHECK", func(payload json.RawMessage) {
		var cmd struct {
			ContainerIDs []string `json:"containerIds"`
		}
		_ = json.Unmarshal(payload, &cmd)

		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
		defer cancel()

		var ids []string
		if len(cmd.ContainerIDs) > 0 {
			// Check specific containers only
			ids = cmd.ContainerIDs
			log.Printf("Running CHECK for %d specific container(s)", len(ids))
		} else {
			// Check all non-excluded, non-pinned containers
			containers, err := dockerClient.ListContainers(ctx)
			if err != nil {
				log.Printf("CHECK failed: %v", err)
				return
			}
			for _, c := range containers {
				if !c.Excluded && !c.PinnedVersion {
					ids = append(ids, c.DockerID)
				}
			}
			log.Printf("Running CHECK for %d containers (%d excluded)", len(ids), len(containers)-len(ids))
		}
		results, err := updater.CheckForUpdates(ctx, ids)
		if err != nil {
			log.Printf("CHECK error: %v", err)
		}
		updatesFound := 0
		for _, r := range results {
			if r.HasUpdate {
				updatesFound++
				log.Printf("Update available: %s (%s -> %s)", r.ContainerName, r.CurrentDigest, r.LatestDigest)
			}
		}
		log.Printf("CHECK complete: %d results, %d updates available", len(results), updatesFound)
		wsClient.Send(Message{Type: "CHECK_RESULT", Payload: map[string]interface{}{"results": results}})
	})

	wsClient.OnMessage("UPDATE", func(payload json.RawMessage) {
		var cmd struct {
			ContainerIDs []string `json:"containerIds"`
			Strategy     string   `json:"strategy"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] UPDATE: invalid payload: %v", err)
			return
		}
		// Use background context — updates must complete even if WS disconnects
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		// Separate self-update from other containers — self must run LAST
		// because the agent process will die during self-update.
		//
		// If self-detection failed at startup (selfContainerID empty), retry now.
		// This handles transient failures (Docker socket not ready at boot) and
		// environments where cgroup v2 private namespace makes startup detection fail.
		if updater.selfContainerID == "" {
			if detected := getSelfContainerID(context.Background(), dockerClient.cli); detected != "" {
				updater.selfContainerID = detected
				log.Printf("[handler] late self-detection succeeded: %s", detected[:12])
			}
		}

		var normalIDs []string
		var selfID string
		for _, id := range cmd.ContainerIDs {
			// Resolve stale container IDs — the controller may hold an old Docker ID
			// from before a previous recreation. IsSelfContainer compares against the
			// current container ID, so a stale ID would fail the check.
			resolved := id
			if r, err := dockerClient.ResolveContainerID(ctx, id); err == nil {
				resolved = r
			}
			if updater.IsSelfContainer(id) || updater.IsSelfContainer(resolved) {
				selfID = id
			} else {
				normalIDs = append(normalIDs, id)
			}
		}

		// Update normal containers first
		for _, id := range normalIDs {
			currentID := id
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[handler] panic updating %s: %v", currentID, r)
						wsClient.Send(Message{Type: "UPDATE_RESULT", Payload: &UpdateResult{
							ContainerID: currentID,
							Success:     false,
							Error:       fmt.Sprintf("internal agent panic: %v", r),
						}})
					}
				}()
				var result *UpdateResult
				var updateErr error
				if cmd.Strategy == "start-first" {
					result, updateErr = updater.BlueGreenUpdate(ctx, currentID)
				} else {
					result, updateErr = updater.UpdateContainer(ctx, currentID)
				}
				if result == nil && updateErr != nil {
					log.Printf("[handler] UPDATE %s failed: %v", currentID, updateErr)
					result = &UpdateResult{
						ContainerID: currentID,
						Success:     false,
						Error:       updateErr.Error(),
					}
				}
				wsClient.SendCritical(ctx, Message{Type: "UPDATE_RESULT", Payload: result})
			}()
		}

		// Self-update: use SelfUpdate which renames self, starts the new
		// container, then force-removes the old one. This avoids the
		// restart-policy trap where ContainerStop marks the container as
		// "manually stopped" and unless-stopped never restarts it.
		if selfID != "" {
			log.Printf("[handler] self-update: replacing own container %s", selfID[:12])
			result, updateErr := updater.SelfUpdate(ctx, selfID)
			// If we reach here, SelfUpdate failed before the force-remove.
			if result == nil && updateErr != nil {
				result = &UpdateResult{
					ContainerID: selfID,
					Success:     false,
					Error:       updateErr.Error(),
				}
			}
			wsClient.SendCritical(ctx, Message{Type: "UPDATE_RESULT", Payload: result})
		}

		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	wsClient.OnMessage("UPDATE_SEQUENTIAL", func(payload json.RawMessage) {
		var cmd struct {
			Batches []struct {
				ContainerIDs   []string `json:"containerIds"`
				WaitForHealthy bool     `json:"waitForHealthy"`
				HealthTimeout  int      `json:"healthTimeout"`
			} `json:"batches"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] UPDATE_SEQUENTIAL: invalid payload: %v", err)
			return
		}
		// Use background context — sequential updates must complete even if WS disconnects
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		// Retry self-detection if it failed at startup (same logic as UPDATE handler).
		if updater.selfContainerID == "" {
			if detected := getSelfContainerID(context.Background(), dockerClient.cli); detected != "" {
				updater.selfContainerID = detected
				log.Printf("[handler] late self-detection succeeded: %s", detected[:12])
			}
		}

		// Collect the self-container ID if it appears in any batch — it must run
		// last via SelfUpdate (not UpdateContainer), same as the UPDATE handler.
		// Resolve stale IDs before comparing so a previously-recreated container
		// still matches selfContainerID.
		var selfID string
		for _, batch := range cmd.Batches {
			for _, id := range batch.ContainerIDs {
				resolved := id
				if r, err := dockerClient.ResolveContainerID(ctx, id); err == nil {
					resolved = r
				}
				if updater.IsSelfContainer(id) || updater.IsSelfContainer(resolved) {
					selfID = id
				}
			}
		}

		for i, batch := range cmd.Batches {
			log.Printf("[sequential] Batch %d/%d: %d containers", i+1, len(cmd.Batches), len(batch.ContainerIDs))
			for _, id := range batch.ContainerIDs {
				if id == selfID {
					continue // handled after all batches complete
				}
				result, updateErr := updater.UpdateContainer(ctx, id)
				if result == nil && updateErr != nil {
					result = &UpdateResult{ContainerID: id, Success: false, Error: updateErr.Error()}
				}
				wsClient.SendCritical(ctx, Message{Type: "UPDATE_RESULT", Payload: result})
			}
			if batch.WaitForHealthy && i < len(cmd.Batches)-1 {
				timeout := batch.HealthTimeout
				if timeout <= 0 {
					timeout = 30
				}
				log.Printf("[sequential] Waiting %ds for batch %d health...", timeout, i+1)
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Duration(timeout) * time.Second):
				}
			}
		}

		// Self-update must run last — after all other containers have been updated.
		if selfID != "" {
			log.Printf("[handler] self-update (sequential): replacing own container %s", selfID[:12])
			result, updateErr := updater.SelfUpdate(ctx, selfID)
			if result == nil && updateErr != nil {
				result = &UpdateResult{ContainerID: selfID, Success: false, Error: updateErr.Error()}
			}
			wsClient.SendCritical(ctx, Message{Type: "UPDATE_RESULT", Payload: result})
		}
		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	wsClient.OnMessage("ROLLBACK", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID   string `json:"containerId"`
			ContainerName string `json:"containerName"`
			TargetImage   string `json:"targetImage"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] ROLLBACK: invalid payload: %v", err)
			return
		}
		// Use background context — rollback must complete even if WS disconnects
		// mid-operation, otherwise the container is left stopped/removed with no recovery.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		resolved, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID)
		if err != nil && cmd.ContainerName != "" {
			resolved, err = dockerClient.ResolveContainerID(ctx, cmd.ContainerName)
		}
		if err == nil {
			resolvedID = resolved
		}
		log.Printf("ROLLBACK: requested=%s name=%s resolved=%s target=%s", cmd.ContainerID, cmd.ContainerName, resolvedID, cmd.TargetImage)
		var result *UpdateResult
		var rollbackErr error
		if cmd.TargetImage != "" {
			result, rollbackErr = updater.RollbackToImage(ctx, resolvedID, cmd.TargetImage, cmd.ContainerID)
		} else {
			result, rollbackErr = updater.RollbackContainer(ctx, resolvedID)
		}
		if result == nil && rollbackErr != nil {
			result = &UpdateResult{
				ContainerID: cmd.ContainerID, ContainerName: cmd.ContainerName,
				Success: false, Error: rollbackErr.Error(), IsRollback: true,
			}
		}
		if result != nil {
			wsClient.Send(Message{Type: "UPDATE_RESULT", Payload: result})
			if containers, err := dockerClient.ListContainers(ctx); err == nil {
				wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
			}
		}
	})

	wsClient.OnMessage("CREDENTIALS_SYNC", func(payload json.RawMessage) {
		var syncPayload struct {
			Credentials []RegistryCredential `json:"credentials"`
		}
		if err := json.Unmarshal(payload, &syncPayload); err != nil {
			log.Printf("[handler] CREDENTIALS_SYNC: invalid payload: %v", err)
			return
		}
		credStore.Set(syncPayload.Credentials)
		log.Printf("Synced %d registry credentials", len(syncPayload.Credentials))
	})

	wsClient.OnMessage("MONITOR_HEALTH", func(payload json.RawMessage) {
		var req MonitorRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			log.Printf("[handler] MONITOR_HEALTH: invalid payload: %v", err)
			return
		}
		log.Printf("[health] Starting monitoring for %s (%ds window)", req.ContainerName, req.DurationSeconds)
		healthMonitor.StartMonitoring(req)
	})

	wsClient.OnMessage("PRUNE", func(payload json.RawMessage) {
		var cmd struct {
			KeepPrevious int  `json:"keepPrevious"`
			DryRun       bool `json:"dryRun"`
		}
		cmd.KeepPrevious = 1
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] PRUNE: invalid payload: %v", err)
			return
		}
		if cmd.KeepPrevious < 0 {
			cmd.KeepPrevious = 1
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		result := pruner.Prune(ctx, cmd.KeepPrevious, cmd.DryRun)
		wsClient.Send(Message{Type: "PRUNE_RESULT", Payload: result})
	})

	wsClient.OnMessage("SCAN", func(payload json.RawMessage) {
		if scanner == nil {
			return
		}
		var cmd struct {
			ContainerID   string `json:"containerId"`
			ContainerName string `json:"containerName"`
			Image         string `json:"image"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] SCAN: invalid payload: %v", err)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		result, err := scanner.Scan(ctx, cmd.ContainerID, cmd.ContainerName, cmd.Image)
		if err != nil {
			log.Printf("[scanner] %s: %v", cmd.Image, err)
			return
		}
		wsClient.Send(Message{Type: "SCAN_RESULT", Payload: result})
	})

	wsClient.OnMessage("CONTAINER_START", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID string `json:"containerId"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		log.Printf("[container] Starting %s", cmd.ContainerID)
		err := dockerClient.cli.ContainerStart(ctx, resolvedID, container.StartOptions{})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[container] Start %s failed: %v", cmd.ContainerID, err)
		} else {
			log.Printf("[container] Started %s", cmd.ContainerID)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action": "start", "containerId": cmd.ContainerID, "success": success, "error": errStr,
		}})
		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	wsClient.OnMessage("CONTAINER_STOP", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID string `json:"containerId"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		log.Printf("[container] Stopping %s", cmd.ContainerID)
		timeout := 10
		err := dockerClient.cli.ContainerStop(ctx, resolvedID, container.StopOptions{Timeout: &timeout})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[container] Stop %s failed: %v", cmd.ContainerID, err)
		} else {
			log.Printf("[container] Stopped %s", cmd.ContainerID)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action": "stop", "containerId": cmd.ContainerID, "success": success, "error": errStr,
		}})
		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	wsClient.OnMessage("CONTAINER_DELETE", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID string `json:"containerId"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		log.Printf("[container] Deleting %s", cmd.ContainerID)
		err := dockerClient.cli.ContainerRemove(ctx, resolvedID, container.RemoveOptions{Force: true})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[container] Delete %s failed: %v", cmd.ContainerID, err)
		} else {
			log.Printf("[container] Deleted %s", cmd.ContainerID)
			deleteSnapshot(cmd.ContainerID)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action": "delete", "containerId": cmd.ContainerID, "success": success, "error": errStr,
		}})
		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	wsClient.OnMessage("CONTAINER_RESTART", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID string `json:"containerId"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		log.Printf("[container] Restarting %s", cmd.ContainerID)
		timeout := 10
		_ = dockerClient.cli.ContainerStop(ctx, resolvedID, container.StopOptions{Timeout: &timeout})
		err := dockerClient.cli.ContainerStart(ctx, resolvedID, container.StartOptions{})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[container] Restart %s failed: %v", cmd.ContainerID, err)
		} else {
			log.Printf("[container] Restarted %s", cmd.ContainerID)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action": "restart", "containerId": cmd.ContainerID, "success": success, "error": errStr,
		}})
		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	// RESTART_UNHEALTHY restarts a set of containers in dependency order:
	// all containers are stopped in reverse-priority order first, then started
	// in forward-priority order with optional health waits between batches.
	// Batches are computed by the controller (topological sort by priority/depends_on).
	wsClient.OnMessage("RESTART_UNHEALTHY", func(payload json.RawMessage) {
		var cmd struct {
			Batches []struct {
				ContainerIDs   []string `json:"containerIds"`
				WaitForHealthy bool     `json:"waitForHealthy"`
				HealthTimeout  int      `json:"healthTimeout"`
			} `json:"batches"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] RESTART_UNHEALTHY: invalid payload: %v", err)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		// Resolve all IDs up front to avoid repeated lookups.
		type idPair struct{ original, resolved string }
		batchResolved := make([][]idPair, len(cmd.Batches))
		for i, batch := range cmd.Batches {
			for _, id := range batch.ContainerIDs {
				resolved := id
				if r, err := dockerClient.ResolveContainerID(ctx, id); err == nil {
					resolved = r
				}
				batchResolved[i] = append(batchResolved[i], idPair{id, resolved})
			}
		}

		// Phase 1: stop all containers in reverse-batch order (dependents before dependencies).
		log.Printf("[restart-unhealthy] Stopping %d batches", len(cmd.Batches))
		stopTimeout := 10
		for i := len(batchResolved) - 1; i >= 0; i-- {
			for _, pair := range batchResolved[i] {
				log.Printf("[restart-unhealthy] Stopping %s", pair.original)
				if err := dockerClient.cli.ContainerStop(ctx, pair.resolved, container.StopOptions{Timeout: &stopTimeout}); err != nil {
					log.Printf("[restart-unhealthy] Stop %s failed: %v (continuing)", pair.original, err)
				}
			}
		}
		// Brief pause so network namespaces are fully released before we start dependencies.
		time.Sleep(2 * time.Second)

		// Phase 2: start containers in forward-batch order (dependencies before dependents).
		for i, batch := range cmd.Batches {
			log.Printf("[restart-unhealthy] Starting batch %d/%d (%d containers)", i+1, len(cmd.Batches), len(batchResolved[i]))
			for _, pair := range batchResolved[i] {
				log.Printf("[restart-unhealthy] Starting %s", pair.original)
				if err := dockerClient.cli.ContainerStart(ctx, pair.resolved, container.StartOptions{}); err != nil {
					log.Printf("[restart-unhealthy] Start %s failed: %v", pair.original, err)
				}
			}

			// Wait for each container in the batch to be healthy before proceeding.
			if batch.WaitForHealthy && i < len(cmd.Batches)-1 {
				timeout := batch.HealthTimeout
				if timeout <= 0 {
					timeout = 120
				}
				log.Printf("[restart-unhealthy] Waiting up to %ds for batch %d to be healthy", timeout, i+1)
				for _, pair := range batchResolved[i] {
					if waitForContainerRunningOrHealthy(ctx, dockerClient.cli, pair.resolved, timeout) {
						log.Printf("[restart-unhealthy] %s is ready", pair.original)
					} else {
						log.Printf("[restart-unhealthy] %s did not become healthy in time — proceeding anyway", pair.original)
					}
				}
			}
		}

		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
		log.Printf("[restart-unhealthy] Complete")
	})

	wsClient.OnMessage("CONTAINER_LOGS", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID string `json:"containerId"`
			Tail        int    `json:"tail"`
			RequestID   string `json:"requestId"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			return
		}
		if cmd.Tail <= 0 {
			cmd.Tail = 100
		}
		if cmd.Tail > 5000 {
			cmd.Tail = 5000
		}
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 30*time.Second)
		defer cancel()
		logs, err := dockerClient.GetContainerLogs(ctx, cmd.ContainerID, cmd.Tail)
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
		}
		wsClient.Send(Message{Type: "CONTAINER_LOGS_RESULT", Payload: map[string]interface{}{
			"requestId": cmd.RequestID, "containerId": cmd.ContainerID,
			"logs": logs, "success": success, "error": errStr,
		}})
	})

	wsClient.OnMessage("CONFIG_UPDATE", func(payload json.RawMessage) {
		var configUpdate struct {
			Schedule   string `json:"schedule"`
			AutoUpdate bool   `json:"autoUpdate"`
		}
		if err := json.Unmarshal(payload, &configUpdate); err != nil {
			return
		}
		if configUpdate.Schedule != "" {
			scheduleMu.Lock()
			localSchedule = configUpdate.Schedule
			scheduleMu.Unlock()
			log.Printf("Schedule updated to: %s", configUpdate.Schedule)
		}
	})

	// Start WebSocket connection
	ctx, cancel := context.WithCancel(context.Background())
	go wsClient.ConnectLoop(ctx)

	updater.StartLockCleanup(ctx)
	healthMonitor.StartCrashLoopDetector(ctx, dockerClient)

	log.Printf("WatchWarden agent '%s' started", cfg.AgentName)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()
	healthMonitor.StopAll()
	scheduler.Disable()
	wsClient.Close()
}
