package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// EventLog is a thread-safe ring buffer of recent agent events.
type EventLog struct {
	mu      sync.RWMutex
	entries []Event
	maxSize int
}

// Event represents a single agent event (check, update, error, etc.).
type Event struct {
	Time          time.Time `json:"time"`
	Type          string    `json:"type"`
	ContainerName string    `json:"containerName,omitempty"`
	Image         string    `json:"image,omitempty"`
	OldDigest     string    `json:"oldDigest,omitempty"`
	NewDigest     string    `json:"newDigest,omitempty"`
	Success       bool      `json:"success"`
	Error         string    `json:"error,omitempty"`
	DurationMs    int64     `json:"durationMs,omitempty"`
	Details       string    `json:"details,omitempty"`
}

// NewEventLog creates a ring buffer with the given max size.
func NewEventLog(maxSize int) *EventLog {
	return &EventLog{
		entries: make([]Event, 0, maxSize),
		maxSize: maxSize,
	}
}

// Add appends an event, evicting the oldest if at capacity.
func (l *EventLog) Add(e Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) >= l.maxSize {
		l.entries = l.entries[1:]
	}
	l.entries = append(l.entries, e)
}

// Recent returns the most recent n events, newest first.
func (l *EventLog) Recent(n int) []Event {
	l.mu.RLock()
	defer l.mu.RUnlock()
	total := len(l.entries)
	if n > total {
		n = total
	}
	result := make([]Event, n)
	for i := 0; i < n; i++ {
		result[i] = l.entries[total-1-i]
	}
	return result
}

// SoloRunner orchestrates solo mode: scheduled checks, auto-updates, notifications.
type SoloRunner struct {
	config    *AgentConfig
	docker    *DockerClient
	updater   *Updater
	pruner    *Pruner
	scanner   *Scanner
	notifier  *Notifier
	healthMon *HealthMonitor
	eventLog  *EventLog
	dockerVer *DockerVersionInfo
}

// runSoloMode starts the agent in self-contained mode with its own scheduler and notifications.
func runSoloMode(cfg *AgentConfig, dockerClient *DockerClient,
	updater *Updater, pruner *Pruner, scanner *Scanner, dockerVer *DockerVersionInfo) {

	ctx, cancel := context.WithCancel(context.Background())

	eventLog := NewEventLog(1000)
	notifier := NewNotifier(cfg)

	if notifier.IsConfigured() {
		log.Printf("[solo] Notifications configured: %s", notifier.Summary())
	} else {
		log.Println("[solo] No notification channels configured")
	}

	// Message sink: fan-out to eventLog + log + notifier
	messageSink := func(msg Message) {
		payload, _ := msg.Payload.(map[string]interface{})

		// Log
		switch msg.Type {
		case "UPDATE_PROGRESS":
			// Don't spam logs with progress
		case "HEALTH_STATUS":
			if name, ok := payload["containerName"]; ok {
				log.Printf("[health] %s: %v", name, payload["status"])
			}
		default:
			log.Printf("[solo] %s event", msg.Type)
		}

		// Record in event log
		evt := Event{Time: time.Now(), Type: msg.Type}
		if payload != nil {
			if v, ok := payload["containerName"].(string); ok {
				evt.ContainerName = v
			}
			if v, ok := payload["success"].(bool); ok {
				evt.Success = v
			}
			if v, ok := payload["error"].(string); ok {
				evt.Error = v
			}
		}
		eventLog.Add(evt)

		// Notify for significant events
		if msg.Type == "UPDATE_RESULT" {
			if result, ok := msg.Payload.(*UpdateResult); ok {
				notifier.NotifyResult(result)
			}
		}
	}

	// Wire progress to message sink
	updater.SetProgressFunc(func(containerID, containerName, step, progress string) {
		messageSink(Message{Type: "UPDATE_PROGRESS", Payload: map[string]interface{}{
			"containerId": containerID, "containerName": containerName,
			"step": step, "progress": progress,
		}})
	})

	healthMon := NewHealthMonitor(dockerClient, updater, messageSink)

	runner := &SoloRunner{
		config:    cfg,
		docker:    dockerClient,
		updater:   updater,
		pruner:    pruner,
		scanner:   scanner,
		notifier:  notifier,
		healthMon: healthMon,
		eventLog:  eventLog,
		dockerVer: dockerVer,
	}

	// Start HTTP server (both modes)
	go startHTTPServer(cfg, dockerClient, eventLog, runner, dockerVer)

	// Start scheduler
	schedule := cfg.Schedule
	scheduler := NewLocalScheduler(func() {
		runner.runCheckCycle(ctx)
	})
	if err := scheduler.Enable(schedule); err != nil {
		log.Fatalf("Invalid schedule %q: %v", schedule, err)
	}

	updater.StartLockCleanup(ctx)
	healthMon.StartCrashLoopDetector(ctx, dockerClient)

	// Run initial check on startup
	go runner.runCheckCycle(ctx)

	log.Printf("WatchWarden agent '%s' started in Solo Mode", cfg.AgentName)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	cancel()
	healthMon.StopAll()
	scheduler.Disable()
}

func (s *SoloRunner) runCheckCycle(ctx context.Context) {
	checkCtx, checkCancel := context.WithTimeout(ctx, 10*time.Minute)
	defer checkCancel()

	containers, err := s.docker.ListContainers(checkCtx)
	if err != nil {
		log.Printf("[solo] Check failed: %v", err)
		return
	}

	var ids []string
	for _, c := range containers {
		if !c.Excluded && !c.PinnedVersion {
			ids = append(ids, c.DockerID)
		}
	}

	log.Printf("[solo] Checking %d containers (%d excluded/pinned)", len(ids), len(containers)-len(ids))
	results, err := s.updater.CheckForUpdates(checkCtx, ids)
	if err != nil {
		log.Printf("[solo] Check error: %v", err)
	}

	var updatesAvailable []CheckResult
	for _, r := range results {
		if r.HasUpdate {
			updatesAvailable = append(updatesAvailable, r)
			log.Printf("[solo] Update available: %s (%s → %s)", r.ContainerName, r.CurrentDigest, r.LatestDigest)
		}
	}

	s.eventLog.Add(Event{
		Time:    time.Now(),
		Type:    "check",
		Details: fmt.Sprintf("checked %d containers, %d updates available", len(results), len(updatesAvailable)),
	})

	if len(updatesAvailable) > 0 {
		s.notifier.NotifyAvailable(s.config.AgentName, updatesAvailable)
	}

	if s.config.AutoUpdate && !s.config.MonitorOnly && len(updatesAvailable) > 0 {
		// Build a lookup of container policies from the full container list
		policyMap := make(map[string]string)
		for _, c := range containers {
			policyMap[c.DockerID] = c.Policy
		}

		// Filter updates by per-container policy
		var autoUpdates []CheckResult
		for _, u := range updatesAvailable {
			p := policyMap[u.ContainerID]
			switch p {
			case "manual":
				log.Printf("[solo] Skipping update for %s: policy=manual", u.ContainerName)
			case "notify":
				log.Printf("[solo] Notify-only for %s: policy=notify (update available but skipped)", u.ContainerName)
			default:
				// "auto" or empty: use global config (already checked above)
				autoUpdates = append(autoUpdates, u)
			}
		}
		if len(autoUpdates) > 0 {
			s.applyUpdates(checkCtx, autoUpdates)
		}
	}
}

func (s *SoloRunner) applyUpdates(ctx context.Context, updates []CheckResult) {
	var results []*UpdateResult
	for _, check := range updates {
		var result *UpdateResult
		var err error

		if s.config.UpdateStrategy == "start-first" {
			result, err = s.updater.BlueGreenUpdate(ctx, check.ContainerID)
		} else {
			result, err = s.updater.UpdateContainer(ctx, check.ContainerID)
		}

		if result == nil && err != nil {
			result = &UpdateResult{
				ContainerID:   check.ContainerID,
				ContainerName: check.ContainerName,
				Success:       false,
				Error:         err.Error(),
			}
		}

		s.eventLog.Add(Event{
			Time:          time.Now(),
			Type:          "update",
			ContainerName: result.ContainerName,
			Image:         check.ContainerName,
			Success:       result.Success,
			Error:         result.Error,
			DurationMs:    result.DurationMs,
			OldDigest:     result.OldDigest,
			NewDigest:     result.NewDigest,
		})

		results = append(results, result)

		// Start health monitoring for successful updates
		if result.Success {
			s.healthMon.StartMonitoring(MonitorRequest{
				ContainerID:       result.ContainerID,
				ContainerName:     result.ContainerName,
				DurationSeconds:   60,
				RollbackOnFailure: true,
				RollbackImage:     check.CurrentDigest,
			})
		}
	}

	// Prune if configured
	if s.config.PruneAfterUpdate {
		pruneResult := s.pruner.Prune(ctx, 1, false)
		log.Printf("[solo] Pruned %d images, reclaimed %d bytes", pruneResult.ImagesRemoved, pruneResult.SpaceReclaimed)
	}

	// Send consolidated notification
	s.notifier.NotifyResults(s.config.AgentName, results)
}
