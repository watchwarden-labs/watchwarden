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

func main() {
	controllerURL := os.Getenv("CONTROLLER_URL")
	if controllerURL == "" {
		log.Fatal("CONTROLLER_URL is required")
	}

	agentToken := os.Getenv("AGENT_TOKEN")
	if agentToken == "" {
		log.Fatal("AGENT_TOKEN is required")
	}

	agentName := os.Getenv("AGENT_NAME")
	if agentName == "" {
		hostname, _ := os.Hostname()
		agentName = hostname
	}

	localSchedule := os.Getenv("LOCAL_SCHEDULE")
	var scheduleMu sync.Mutex
	labelEnableOnly := os.Getenv("WATCHWARDEN_LABEL_ENABLE_ONLY") == "true"

	// Init credential store and Docker client
	credStore := NewCredStore()

	dockerClient, err := NewDockerClient(labelEnableOnly)
	if err != nil {
		log.Fatalf("Failed to create Docker client: %v", err)
	}
	dockerClient.credStore = credStore

	updater := NewUpdater(dockerClient)
	pruner := NewPruner(dockerClient)
	scanner := NewScanner()

	// Init image signature verifier (optional — requires cosign binary)
	requireSigned := os.Getenv("REQUIRE_SIGNED_IMAGES") == "true"
	cosignPublicKey := os.Getenv("COSIGN_PUBLIC_KEY") // PEM content, optional
	verifier := NewVerifier(requireSigned, cosignPublicKey)
	if verifier != nil {
		updater.SetVerifier(verifier)
		defer verifier.Close()
	}

	// DOCKER-02: RecoverOrphans with a 60s timeout — hangs indefinitely if Docker is unresponsive.
	{
		recoverCtx, recoverCancel := context.WithTimeout(context.Background(), 60*time.Second)
		updater.RecoverOrphans(recoverCtx)
		recoverCancel()
	}

	// Fetch Docker version on startup (best-effort)
	dockerVer := dockerClient.GetDockerVersion(context.Background())
	if dockerVer != nil {
		log.Printf("Docker %s (API %s) on %s/%s", dockerVer.ServerVersion, dockerVer.APIVersion, dockerVer.OS, dockerVer.Arch)
	}

	// Scheduler
	scheduler := NewLocalScheduler(func() {
		// ERR-03: use a timeout so a hung Docker daemon doesn't leave goroutines
		// accumulating each cron tick indefinitely.
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
		URL:           controllerURL + "/ws/agent",
		Token:         agentToken,
		AgentName:     agentName,
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
				// RACE-04: hold scheduleMu through scheduler.Enable() to close the
				// TOCTOU window between reading localSchedule and arming the scheduler.
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

	// Init health monitor (needs wsClient.Send, created after wsClient)
	var healthMonitor *HealthMonitor

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

	// Init health monitor
	healthMonitor = NewHealthMonitor(dockerClient, updater, func(msg Message) {
		wsClient.Send(msg)
	})

	// Register message handlers
	wsClient.OnMessage("CHECK", func(payload json.RawMessage) {
		// DOCKER-01: derive from connection context so Docker ops abort on disconnect.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
		defer cancel()
		containers, err := dockerClient.ListContainers(ctx)
		if err != nil {
			log.Printf("CHECK failed: %v", err)
			return
		}
		var ids []string
		for _, c := range containers {
			if !c.Excluded && !c.PinnedVersion {
				ids = append(ids, c.DockerID)
			}
		}
		log.Printf("Running CHECK for %d containers (%d excluded)", len(ids), len(containers)-len(ids))
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

		// DS-02: derive from connection context so Docker ops abort on disconnect.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
		defer cancel()
		for _, id := range cmd.ContainerIDs {
			currentID := id // capture for panic handler — ERR-02
			func() {
				// ERR-02: recover panics inside each container update and send a
				// synthetic UPDATE_RESULT so the controller records the failure and
				// can trigger auto-rollback or notify the operator.
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
				// SCALE-04: use SendCritical so UPDATE_RESULT is never dropped.
				wsClient.SendCritical(ctx, Message{Type: "UPDATE_RESULT", Payload: result})
			}()
		}
		// Send immediate heartbeat so DB gets updated container list
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

		// DOCKER-01: derive from connection context.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 30*time.Minute)
		defer cancel()
		for i, batch := range cmd.Batches {
			log.Printf("[sequential] Batch %d/%d: %d containers", i+1, len(cmd.Batches), len(batch.ContainerIDs))
			for _, id := range batch.ContainerIDs {
				result, updateErr := updater.UpdateContainer(ctx, id)
				if result == nil && updateErr != nil {
					log.Printf("[sequential] UPDATE %s failed: %v", id, updateErr)
					result = &UpdateResult{
						ContainerID: id,
						Success:     false,
						Error:       updateErr.Error(),
					}
				}
				wsClient.SendCritical(ctx, Message{Type: "UPDATE_RESULT", Payload: result})
			}
			// DOCKER-03: use ctx-aware wait between batches.
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
		// Send heartbeat after all batches
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

		// DOCKER-01: derive from connection context.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
		defer cancel()

		// Resolve container ID — try by ID first, then by name
		resolvedID := cmd.ContainerID
		resolved, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID)
		if err != nil && cmd.ContainerName != "" {
			// Try resolving by name
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
			log.Printf("ROLLBACK failed: %v", rollbackErr)
			result = &UpdateResult{
				ContainerID:   cmd.ContainerID,
				ContainerName: cmd.ContainerName,
				Success:       false,
				Error:         rollbackErr.Error(),
				IsRollback:    true,
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
		var sync struct {
			Credentials []RegistryCredential `json:"credentials"`
		}
		if err := json.Unmarshal(payload, &sync); err != nil {
			log.Printf("[handler] CREDENTIALS_SYNC: invalid payload: %v", err)
			return
		}
		credStore.Set(sync.Credentials)
		log.Printf("Synced %d registry credentials", len(sync.Credentials))
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
		cmd.KeepPrevious = 1 // default
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] PRUNE: invalid payload: %v", err)
			return
		}
		if cmd.KeepPrevious < 0 {
			cmd.KeepPrevious = 1
		}

		// DS-02: derive from connection context so Docker ops abort on disconnect.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 5*time.Minute)
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
		// DS-02: derive from connection context so trivy scan aborts on disconnect.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 10*time.Minute)
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
			log.Printf("[handler] CONTAINER_START: invalid payload: %v", err)
			return
		}
		// DS-02: derive from connection context.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		err := dockerClient.cli.ContainerStart(ctx, resolvedID, container.StartOptions{})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[CONTAINER_START] %s: %v", cmd.ContainerID, err)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action":      "start",
			"containerId": cmd.ContainerID,
			"success":     success,
			"error":       errStr,
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
			log.Printf("[handler] CONTAINER_STOP: invalid payload: %v", err)
			return
		}
		// DS-02: derive from connection context.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		timeout := 10
		err := dockerClient.cli.ContainerStop(ctx, resolvedID, container.StopOptions{Timeout: &timeout})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[CONTAINER_STOP] %s: %v", cmd.ContainerID, err)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action":      "stop",
			"containerId": cmd.ContainerID,
			"success":     success,
			"error":       errStr,
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
			log.Printf("[handler] CONTAINER_DELETE: invalid payload: %v", err)
			return
		}
		// DS-02: derive from connection context.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 2*time.Minute)
		defer cancel()
		resolvedID := cmd.ContainerID
		if r, err := dockerClient.ResolveContainerID(ctx, cmd.ContainerID); err == nil {
			resolvedID = r
		}
		err := dockerClient.cli.ContainerRemove(ctx, resolvedID, container.RemoveOptions{Force: true})
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[CONTAINER_DELETE] %s: %v", cmd.ContainerID, err)
		}
		if success {
			deleteSnapshot(cmd.ContainerID)
		}
		wsClient.Send(Message{Type: "CONTAINER_ACTION_RESULT", Payload: map[string]interface{}{
			"action":      "delete",
			"containerId": cmd.ContainerID,
			"success":     success,
			"error":       errStr,
		}})
		if containers, err := dockerClient.ListContainers(ctx); err == nil {
			wsClient.Send(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
		}
	})

	wsClient.OnMessage("CONTAINER_LOGS", func(payload json.RawMessage) {
		var cmd struct {
			ContainerID string `json:"containerId"`
			Tail        int    `json:"tail"`
			RequestID   string `json:"requestId"`
		}
		if err := json.Unmarshal(payload, &cmd); err != nil {
			log.Printf("[handler] CONTAINER_LOGS: invalid payload: %v", err)
			return
		}
		if cmd.Tail <= 0 {
			cmd.Tail = 100
		}
		if cmd.Tail > 5000 {
			cmd.Tail = 5000
		}
		// DS-02: derive from connection context.
		ctx, cancel := context.WithTimeout(wsClient.ConnectionCtx(), 30*time.Second)
		defer cancel()
		logs, err := dockerClient.GetContainerLogs(ctx, cmd.ContainerID, cmd.Tail)
		success := err == nil
		errStr := ""
		if err != nil {
			errStr = err.Error()
			log.Printf("[CONTAINER_LOGS] %s: %v", cmd.ContainerID, err)
		}
		wsClient.Send(Message{Type: "CONTAINER_LOGS_RESULT", Payload: map[string]interface{}{
			"requestId":   cmd.RequestID,
			"containerId": cmd.ContainerID,
			"logs":        logs,
			"success":     success,
			"error":       errStr,
		}})
	})

	wsClient.OnMessage("CONFIG_UPDATE", func(payload json.RawMessage) {
		var config struct {
			Schedule   string `json:"schedule"`
			AutoUpdate bool   `json:"autoUpdate"`
		}
		if err := json.Unmarshal(payload, &config); err != nil {
			log.Printf("[handler] CONFIG_UPDATE: invalid payload: %v", err)
			return
		}

		if config.Schedule != "" {
			scheduleMu.Lock()
			localSchedule = config.Schedule
			scheduleMu.Unlock()
			log.Printf("Schedule updated to: %s", config.Schedule)
		}
	})

	// Start WebSocket connection
	ctx, cancel := context.WithCancel(context.Background())
	go wsClient.ConnectLoop(ctx)

	// RACE-03: periodically clean up idle per-container mutex entries.
	updater.StartLockCleanup(ctx)

	// Start continuous crash loop detection
	healthMonitor.StartCrashLoopDetector(ctx, dockerClient)

	log.Printf("WatchWarden agent '%s' started", agentName)

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()
	healthMonitor.StopAll()
	scheduler.Disable()
	wsClient.Close()
}
