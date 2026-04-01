package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
)

// HealthMonitor watches container health after updates and triggers auto-rollback if unhealthy.
type HealthMonitor struct {
	docker   *DockerClient
	updater  *Updater
	sendMsg  func(Message)
	monitors map[string]*monitorEntry
	// BUG-10 FIX: track containers with a rollback in progress to prevent the
	// health monitor and crash loop detector from both triggering redundant
	// rollbacks for the same container.
	rollbackInProgress map[string]bool
	mu                 sync.Mutex
	ctx                context.Context
	cancel             context.CancelFunc
}

type monitorEntry struct {
	containerID    string
	containerName  string
	rollbackImage  string
	progressID     string // original container ID for WS progress tracking
	deadline       time.Time
	maxUnhealthy   time.Duration
	unhealthySince *time.Time
	cancel         context.CancelFunc
}

// MonitorRequest is the payload from the controller's MONITOR_HEALTH message.
type MonitorRequest struct {
	ContainerID       string `json:"containerId"`
	ContainerName     string `json:"containerName"`
	DurationSeconds   int    `json:"durationSeconds"`
	RollbackOnFailure bool   `json:"rollbackOnFailure"`
	RollbackImage     string `json:"rollbackImage"`
}

// NewHealthMonitor creates a health monitor.
func NewHealthMonitor(docker *DockerClient, updater *Updater, sendMsg func(Message)) *HealthMonitor {
	ctx, cancel := context.WithCancel(context.Background())
	return &HealthMonitor{
		docker:             docker,
		updater:            updater,
		rollbackInProgress: make(map[string]bool),
		sendMsg:            sendMsg,
		monitors:           make(map[string]*monitorEntry),
		ctx:                ctx,
		cancel:             cancel,
	}
}

// StartMonitoring begins health monitoring for a container after an update.
func (h *HealthMonitor) StartMonitoring(req MonitorRequest) {
	h.mu.Lock()
	// Cancel existing monitor for this container
	if existing, ok := h.monitors[req.ContainerID]; ok {
		existing.cancel()
	}
	h.mu.Unlock()

	ctx, cancel := context.WithCancel(h.ctx)

	entry := &monitorEntry{
		containerID:   req.ContainerID,
		containerName: req.ContainerName,
		rollbackImage: req.RollbackImage,
		progressID:    req.ContainerID,
		deadline:      time.Now().Add(time.Duration(req.DurationSeconds) * time.Second),
		maxUnhealthy:  30 * time.Second, // default, can be overridden via req
		cancel:        cancel,
	}

	h.mu.Lock()
	h.monitors[req.ContainerID] = entry
	h.mu.Unlock()

	go h.monitor(ctx, entry, req.RollbackOnFailure)
}

// StopMonitoring cancels monitoring for a specific container.
// StopAll cancels all monitor goroutines and the parent context.
func (h *HealthMonitor) StopAll() {
	h.cancel()
}

func (h *HealthMonitor) StopMonitoring(containerID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if entry, ok := h.monitors[containerID]; ok {
		entry.cancel()
		delete(h.monitors, containerID)
	}
}

func (h *HealthMonitor) monitor(ctx context.Context, entry *monitorEntry, rollbackOnFailure bool) {
	defer func() {
		h.mu.Lock()
		delete(h.monitors, entry.containerID)
		h.mu.Unlock()
	}()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	log.Printf("[health] Monitoring %s for %ds", entry.containerName, int(time.Until(entry.deadline).Seconds()))

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Now().After(entry.deadline) {
				// Stability window passed — container is stable
				log.Printf("[health] %s passed stability window — healthy", entry.containerName)
				h.sendStatus(entry, "healthy")
				return
			}

			status := h.checkHealth(ctx, entry.containerID)
			h.sendStatus(entry, status)

			switch status {
			case "healthy":
				entry.unhealthySince = nil

			case "unhealthy":
				now := time.Now()
				if entry.unhealthySince == nil {
					entry.unhealthySince = &now
				}
				unhealthyDuration := time.Since(*entry.unhealthySince)
				if unhealthyDuration > entry.maxUnhealthy && rollbackOnFailure {
					log.Printf("[health] %s unhealthy for %ds — triggering auto-rollback", entry.containerName, int(unhealthyDuration.Seconds()))
					h.triggerRollback(entry)
					return
				}

			case "removed":
				// Container was intentionally removed — stop monitoring, don't rollback
				log.Printf("[health] %s was removed — stopping monitor (no rollback)", entry.containerName)
				return

			case "starting":
				// Still starting, reset unhealthy timer
				entry.unhealthySince = nil

			case "none":
				// No healthcheck configured — just let stability window pass
				entry.unhealthySince = nil
			}
		}
	}
}

func (h *HealthMonitor) checkHealth(ctx context.Context, containerID string) string {
	// Resolve container ID (may have changed after recreation)
	resolvedID, err := h.docker.ResolveContainerID(ctx, containerID)
	if err != nil {
		return "removed" // Container no longer exists — not unhealthy, just gone
	}

	info, err := h.docker.cli.ContainerInspect(ctx, resolvedID)
	if err != nil {
		return "removed" // Container disappeared between resolve and inspect
	}

	// Check if container is running
	if info.State == nil || !info.State.Running {
		return "unhealthy"
	}

	// Check Docker healthcheck if configured
	if info.State.Health != nil {
		switch info.State.Health.Status {
		case "healthy":
			return "healthy"
		case "unhealthy":
			return "unhealthy"
		case "starting":
			return "starting"
		}
	}

	// No healthcheck configured — consider running as healthy
	return "none"
}

func (h *HealthMonitor) triggerRollback(entry *monitorEntry) {
	h.triggerRollbackWithReason(entry, "Container unhealthy during stability window")
}

func (h *HealthMonitor) triggerRollbackWithReason(entry *monitorEntry, reason string) {
	// BUG-10 FIX: prevent double-rollback from health monitor + crash loop detector
	// racing on the same container. Check and set atomically under the mutex.
	h.mu.Lock()
	containerKey := entry.containerID
	if len(containerKey) > 12 {
		containerKey = containerKey[:12]
	}
	if h.rollbackInProgress[containerKey] {
		h.mu.Unlock()
		log.Printf("[health] rollback already in progress for %s, skipping", entry.containerName)
		return
	}
	h.rollbackInProgress[containerKey] = true
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.rollbackInProgress, containerKey)
		h.mu.Unlock()
	}()

	h.sendStatus(entry, "unhealthy")

	ctx := context.Background()
	var result *UpdateResult
	var rollbackErr error

	if entry.rollbackImage != "" {
		result, rollbackErr = h.updater.RollbackToImage(ctx, entry.containerID, entry.rollbackImage, entry.progressID)
	} else {
		result, rollbackErr = h.updater.RollbackContainer(ctx, entry.containerID)
	}
	if result == nil && rollbackErr != nil {
		log.Printf("[health] auto-rollback failed for %s: %v", entry.containerName, rollbackErr)
		result = &UpdateResult{
			ContainerID:   entry.containerID,
			ContainerName: entry.containerName,
			Success:       false,
			Error:         rollbackErr.Error(),
			IsRollback:    true,
		}
	}

	if result != nil {
		result.IsRollback = true
		h.sendMsg(Message{
			Type: "UPDATE_RESULT",
			Payload: map[string]interface{}{
				"containerId":    result.ContainerID,
				"containerName":  result.ContainerName,
				"success":        result.Success,
				"oldDigest":      result.OldDigest,
				"newDigest":      result.NewDigest,
				"error":          result.Error,
				"durationMs":     result.DurationMs,
				"isRollback":     true,
				"autoRolledBack": true,
				"rollbackReason": reason,
			},
		})
	}

	// Send immediate heartbeat
	if containers, err := h.docker.ListContainers(ctx); err == nil {
		h.sendMsg(Message{Type: "HEARTBEAT", Payload: map[string]interface{}{"containers": containers}})
	}
}

func (h *HealthMonitor) sendStatus(entry *monitorEntry, status string) {
	h.sendMsg(Message{
		Type: "HEALTH_STATUS",
		Payload: map[string]interface{}{
			"containerId":   entry.containerID,
			"containerName": entry.containerName,
			"status":        status,
		},
	})
}

// --- Crash Loop Detection (continuous, runs alongside heartbeats) ---

// minCrashLoopRestarts is the minimum number of restarts (delta from baseline)
// required before a crash loop rollback is triggered. A single restart is normal
// for containers with restart: always.
const minCrashLoopRestarts = 3

// restartTracker tracks container restart counts to detect crash loops.
type restartTracker struct {
	lastRestartCount int
	baseRestartCount int // restart count when crash tracking started
	crashStart       *time.Time
}

// StartCrashLoopDetector runs a background goroutine that checks all containers
// for crash loops (repeated restarts). Reports HEALTH_STATUS for crashing containers.
func (h *HealthMonitor) StartCrashLoopDetector(ctx context.Context, docker *DockerClient) {
	trackers := make(map[string]*restartTracker)

	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.detectCrashLoops(ctx, docker, trackers)
			}
		}
	}()
}

func (h *HealthMonitor) detectCrashLoops(ctx context.Context, docker *DockerClient, trackers map[string]*restartTracker) {
	// List ALL containers (including stopped/restarting)
	containers, err := docker.cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return
	}

	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		// Skip excluded containers
		if val, ok := c.Labels["com.watchwarden.enable"]; ok && val == "false" {
			continue
		}

		// Check if container is in a restart loop.
		// "exited" is a normal stopped state — do NOT include it here or
		// every stopped container will be reported as unhealthy every tick.
		isRestarting := c.State == "restarting"
		restartCount := 0

		// Get restart count from inspect
		info, err := docker.cli.ContainerInspect(ctx, c.ID)
		if err == nil {
			restartCount = info.RestartCount
		}

		tracker, exists := trackers[c.ID]
		if !exists {
			// Initialize with CURRENT count so we don't false-positive on containers
			// that already have a non-zero restart count before monitoring started.
			tracker = &restartTracker{lastRestartCount: restartCount}
			trackers[c.ID] = tracker
		}

		if isRestarting || restartCount > tracker.lastRestartCount {
			now := time.Now()
			if tracker.crashStart == nil {
				tracker.crashStart = &now
				tracker.baseRestartCount = tracker.lastRestartCount
			}

			crashDuration := time.Since(*tracker.crashStart)
			restartDelta := restartCount - tracker.baseRestartCount

			// Report as unhealthy
			h.sendMsg(Message{
				Type: "HEALTH_STATUS",
				Payload: map[string]interface{}{
					"containerId":   c.ID[:12],
					"containerName": name,
					"status":        "unhealthy",
					"crashLoop":     true,
					"restartCount":  restartCount,
					"crashDuration": int(crashDuration.Seconds()),
				},
			})

			// If crash loop detected for > 60s WITH enough restarts, auto-rollback.
			// A single restart is normal for containers with restart: always.
			if crashDuration > 60*time.Second && restartDelta >= minCrashLoopRestarts {
				h.mu.Lock()
				_, hasMonitor := h.monitors[c.ID[:12]]
				h.mu.Unlock()

				if !hasMonitor {
					// Check if updater has a snapshot for this container
					h.updater.mu.RLock()
					snapshot, hasSnapshot := h.updater.snapshots[c.ID]
					if !hasSnapshot {
						// Try with short ID
						snapshot, hasSnapshot = h.updater.snapshots[c.ID[:12]]
					}
					h.updater.mu.RUnlock()

					if hasSnapshot {
						reason := fmt.Sprintf("Crash loop detected: %d restarts in %ds — auto-restored to previous version",
							restartCount, int(crashDuration.Seconds()))
						log.Printf("[crash-loop] %s: %s (rolling back to %s)", name, reason, snapshot.ImageRef)
						h.triggerRollbackWithReason(&monitorEntry{
							containerID:   c.ID,
							containerName: name,
							rollbackImage: snapshot.ImageRef,
							progressID:    c.ID[:12],
						}, reason)
						tracker.crashStart = nil
						tracker.lastRestartCount = 0
					}
				}
			}
		} else {
			// Container is running fine — reset tracker
			tracker.crashStart = nil
		}

		tracker.lastRestartCount = restartCount
	}

	// Clean up trackers for removed containers
	activeIDs := make(map[string]bool)
	for _, c := range containers {
		activeIDs[c.ID] = true
	}
	for id := range trackers {
		if !activeIDs[id] {
			delete(trackers, id)
		}
	}
}
