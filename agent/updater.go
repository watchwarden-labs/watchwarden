package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
)

// containerLockEntry wraps a mutex with a deleted flag to support safe cleanup.
type containerLockEntry struct {
	mu      sync.Mutex
	deleted bool
}

// ProgressFunc is called during update to report progress.
type ProgressFunc func(containerID, containerName, step, progress string)

// Updater orchestrates container updates with atomicity guarantees.
type Updater struct {
	docker     *DockerClient
	snapshots  map[string]*ContainerSnapshot
	mu         sync.RWMutex
	onProgress ProgressFunc
	verifier   *Verifier
	// Per-container lock to prevent concurrent updates to the same container.
	// Uses containerLockEntry with a deleted flag so cleanup can safely remove
	// idle entries without racing against goroutines that hold a reference but
	// haven't called mu.Lock() yet.
	containerLocks   map[string]*containerLockEntry
	containerLocksMu sync.Mutex
}

// NewUpdater creates an Updater with the given Docker client.
// It loads any snapshots persisted to disk so rollback survives agent restarts.
func NewUpdater(docker *DockerClient) *Updater {
	snaps := make(map[string]*ContainerSnapshot)
	loadSnapshots(snaps)
	return &Updater{
		docker:         docker,
		snapshots:      snaps,
		containerLocks: make(map[string]*containerLockEntry),
	}
}

// StartLockCleanup periodically removes idle per-container lock entries.
// Runs until ctx is cancelled. Call from main after creating the Updater.
func (u *Updater) StartLockCleanup(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				u.containerLocksMu.Lock()
				for id, entry := range u.containerLocks {
					// TryLock succeeds only if no goroutine holds the mutex.
					// Mark deleted so any goroutine that already has a reference
					// to this entry will retry and get a fresh entry.
					if entry.mu.TryLock() {
						entry.deleted = true
						delete(u.containerLocks, id)
						entry.mu.Unlock()
					}
				}
				u.containerLocksMu.Unlock()
			}
		}
	}()
}

// RecoverOrphans checks saved snapshots against all containers (running + stopped).
// If a snapshot exists but no container with that name exists at all, attempt recreation.
// DOCKER-04: uses All:true so stopped-but-not-removed containers are not falsely treated as missing.
// BUG-03 FIX: also detects orphaned blue-green containers (*-ww-new suffix) left by a
// crash between container creation and rename. If a -ww-new container exists but the
// original name is missing, complete the transition by renaming instead of recreating
// with the old image (which would leave two containers running the same service).
func (u *Updater) RecoverOrphans(ctx context.Context) {
	u.mu.RLock()
	snapshots := make(map[string]*ContainerSnapshot, len(u.snapshots))
	for k, v := range u.snapshots {
		snapshots[k] = v
	}
	u.mu.RUnlock()

	// Build set of all existing container names (running + stopped) and a map
	// from name to container ID for rename operations.
	existing, err := u.docker.cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		log.Printf("[recovery] Failed to list containers: %v", err)
		return
	}
	existingNames := make(map[string]bool, len(existing))
	nameToID := make(map[string]string, len(existing))
	for _, c := range existing {
		for _, n := range c.Names {
			clean := strings.TrimPrefix(n, "/")
			existingNames[clean] = true
			nameToID[clean] = c.ID
		}
	}

	// BUG-03: first pass — detect and resolve orphaned blue-green containers.
	// If "nginx-ww-new" exists but "nginx" does not, rename -ww-new to complete
	// the interrupted blue-green transition.
	const blueGreenSuffix = "-ww-new"
	for name, id := range nameToID {
		if !strings.HasSuffix(name, blueGreenSuffix) {
			continue
		}
		originalName := strings.TrimSuffix(name, blueGreenSuffix)
		if existingNames[originalName] {
			// Both exist — clean up the -ww-new orphan (old container survived)
			log.Printf("[recovery] Removing orphaned blue-green container %s (original %s still exists)", name, originalName)
			timeout := 10
			_ = u.docker.cli.ContainerStop(ctx, id, container.StopOptions{Timeout: &timeout})
			_ = u.docker.cli.ContainerRemove(ctx, id, container.RemoveOptions{})
			continue
		}
		// Original missing — complete the transition by renaming
		log.Printf("[recovery] Completing interrupted blue-green: renaming %s → %s", name, originalName)
		if err := u.docker.ContainerRename(ctx, id, originalName); err != nil {
			log.Printf("[recovery] Failed to rename %s → %s: %v", name, originalName, err)
		} else {
			log.Printf("[recovery] Successfully completed blue-green recovery for %s", originalName)
			existingNames[originalName] = true // mark as recovered for second pass
		}
	}

	// Second pass — standard snapshot-based recovery for missing containers.
	seen := make(map[string]bool)
	for _, snap := range snapshots {
		if seen[snap.Name] {
			continue
		}
		seen[snap.Name] = true

		if existingNames[snap.Name] {
			continue // container exists (running or stopped) — no recovery needed
		}

		// DS-03: prefer ImageDigest (exact pre-update version) over ImageRef which
		// resolves to whatever :latest currently is — that may be the same broken image
		// that caused the outage in the first place, creating a crash-restart loop.
		recoveryRef := snap.ImageDigest
		if recoveryRef == "" {
			recoveryRef = snap.ImageRef
		}
		log.Printf("[recovery] Container %s missing — attempting recreation from snapshot", snap.Name)
		_, err = u.docker.RecreateContainer(ctx, snap, recoveryRef)
		if err != nil {
			log.Printf("[recovery] Failed to recover %s: %v", snap.Name, err)
		} else {
			log.Printf("[recovery] Successfully recovered %s", snap.Name)
		}
	}
}

// lockContainer acquires a per-container mutex, preventing concurrent updates.
// Returns the locked entry; caller must defer entry.mu.Unlock().
// Retries if the entry was concurrently deleted by StartLockCleanup.
//
// FIX-1.2: the deleted-flag check and the map lookup are now performed in a
// single containerLocksMu critical section, closing the window where cleanup
// could delete and nil-out an entry between the flag check and return.
func (u *Updater) lockContainer(containerID string) *containerLockEntry {
	for {
		u.containerLocksMu.Lock()
		entry, ok := u.containerLocks[containerID]
		if !ok {
			entry = &containerLockEntry{}
			u.containerLocks[containerID] = entry
		}
		u.containerLocksMu.Unlock()

		entry.mu.Lock()

		// Re-check under containerLocksMu that the entry is still in the map
		// AND not marked deleted. Both conditions must hold atomically.
		u.containerLocksMu.Lock()
		current, inMap := u.containerLocks[containerID]
		valid := inMap && current == entry && !entry.deleted
		u.containerLocksMu.Unlock()
		if valid {
			return entry
		}
		entry.mu.Unlock()
	}
}

// SetVerifier attaches a Verifier for image signing checks.
func (u *Updater) SetVerifier(v *Verifier) {
	u.verifier = v
}

// SetProgressFunc sets the callback for update progress notifications.
func (u *Updater) SetProgressFunc(fn ProgressFunc) {
	u.onProgress = fn
}

func (u *Updater) emitProgress(containerID, containerName, step, progress string) {
	if u.onProgress != nil {
		u.onProgress(containerID, containerName, step, progress)
	}
}

// isNonFatalRemoveErr returns true if the error from ContainerRemove indicates
// the container is already gone (e.g. AutoRemove triggered by ContainerStop).
func isNonFatalRemoveErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "404") ||
		strings.Contains(msg, "409") ||
		strings.Contains(msg, "No such container") ||
		strings.Contains(msg, "no such container") ||
		strings.Contains(msg, "removal already in progress") ||
		strings.Contains(msg, "is already in progress")
}

// digestsMatch compares two digests, ignoring the "image@" prefix.
// e.g. "nginx@sha256:abc123" matches "sha256:abc123"
func digestsMatch(a, b string) bool {
	return extractDigest(a) == extractDigest(b)
}

func extractDigest(s string) string {
	if idx := strings.Index(s, "sha256:"); idx >= 0 {
		return s[idx:]
	}
	return s
}

// CheckForUpdates compares current vs latest digests for the given containers.
// RC-02: locks by canonical container name (stable across recreations) so CHECK
// and UPDATE always serialize on the same key even after a container is recreated.
// SCALE-03: releases the lock before docker pull — the registry read is idempotent
// and does not need to hold the mutex for potentially minutes.
func (u *Updater) CheckForUpdates(ctx context.Context, containerIDs []string) ([]CheckResult, error) {
	var results []CheckResult

	for _, id := range containerIDs {
		// Pre-inspect (no lock) to get the canonical container name for the lock key.
		// If the container is mid-update (temporarily absent), inspect fails → skip
		// this cycle; the next scheduled check will catch it — RC-02.
		preSnap, err := u.docker.InspectContainer(ctx, id)
		if err != nil {
			continue
		}

		// Lock by canonical name so this check serializes with UpdateContainer /
		// RollbackContainer / BlueGreenUpdate regardless of Docker ID changes — RC-02.
		entry := u.lockContainer(preSnap.Name)

		// Re-inspect inside the lock for authoritative current state.
		snapshot, err := u.docker.InspectContainer(ctx, id)
		if err != nil {
			entry.mu.Unlock()
			continue
		}
		entry.mu.Unlock() // SCALE-03: release before pull; registry read needs no container lock

		// Pull outside the lock — SCALE-03
		newDigest, err := u.docker.PullImage(ctx, snapshot.ImageRef)
		if err != nil {
			continue
		}

		hasUpdate := newDigest != "" && !digestsMatch(snapshot.ImageDigest, newDigest)

		var diff *ImageDiff
		if hasUpdate {
			currentImg, _, err1 := u.docker.cli.ImageInspectWithRaw(ctx, snapshot.ImageDigest)
			targetImg, _, err2 := u.docker.cli.ImageInspectWithRaw(ctx, snapshot.ImageRef)
			if err1 == nil && err2 == nil {
				d := DiffImages(currentImg, targetImg)
				diff = &d
			}
		} else if newDigest != "" {
			// BUG-12 FIX: digest matches but image config may have changed (same layers,
			// different entrypoint/env/labels). If image IDs differ, treat as an update
			// so config-only changes are not silently ignored.
			currentImg, _, err1 := u.docker.cli.ImageInspectWithRaw(ctx, snapshot.ImageDigest)
			targetImg, _, err2 := u.docker.cli.ImageInspectWithRaw(ctx, snapshot.ImageRef)
			if err1 == nil && err2 == nil && currentImg.ID != targetImg.ID {
				log.Printf("[check] %s: digest unchanged but image ID differs (config-only change) — marking as update", snapshot.Name)
				hasUpdate = true
				d := DiffImages(currentImg, targetImg)
				diff = &d
			}
		}

		results = append(results, CheckResult{
			ContainerID:   id,
			ContainerName: snapshot.Name,
			CurrentDigest: snapshot.ImageDigest,
			LatestDigest:  newDigest,
			HasUpdate:     hasUpdate,
			Diff:          diff,
		})
	}

	return results, nil
}

// UpdateContainer performs an atomic update: snapshot -> pull -> stop -> remove -> create -> start.
func (u *Updater) UpdateContainer(ctx context.Context, containerID string) (*UpdateResult, error) {
	start := time.Now()

	// Resolve to canonical ID first (handles stale IDs after recreation) — RC-02
	resolvedID, err := u.docker.ResolveContainerID(ctx, containerID)
	if err == nil {
		containerID = resolvedID
	}

	// Pre-inspect (outside lock) to get canonical name for stable lock key — RC-02
	preSnap, err := u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		return &UpdateResult{
			ContainerID: containerID,
			Success:     false,
			Error:       fmt.Sprintf("inspect failed: %v", err),
			DurationMs:  time.Since(start).Milliseconds(),
		}, err
	}

	// RACE-01 + RC-02: lock by canonical name (stable across recreations).
	// BUG-06 FIX: acquire lock for inspect, release during pull (which can take
	// minutes and doesn't need serialization), then re-acquire for the destructive
	// stop/remove/create sequence. This prevents a hung docker pull from holding
	// the lock for 10 minutes, blocking rollbacks and health checks.
	entry := u.lockContainer(preSnap.Name)

	// 1. Snapshot current container (authoritative state inside the lock)
	snapshot, err := u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		entry.mu.Unlock()
		return &UpdateResult{
			ContainerID: containerID,
			Success:     false,
			Error:       fmt.Sprintf("inspect failed: %v", err),
			DurationMs:  time.Since(start).Milliseconds(),
		}, err
	}

	// 2. Verify image signature (if verifier is configured)
	if u.verifier != nil {
		if err := u.verifier.Verify(ctx, snapshot.ImageRef); err != nil {
			entry.mu.Unlock()
			return &UpdateResult{
				ContainerID:   containerID,
				ContainerName: snapshot.Name,
				Success:       false,
				OldDigest:     snapshot.ImageDigest,
				Error:         err.Error(),
				DurationMs:    time.Since(start).Milliseconds(),
			}, err
		}
	}

	// Release lock during pull — pull is idempotent and doesn't modify container
	// state. Other operations (CHECK, ROLLBACK) can proceed while we pull.
	imageRef := snapshot.ImageRef
	entry.mu.Unlock()

	// 3. Pull new image (outside lock — BUG-06)
	u.emitProgress(containerID, snapshot.Name, "pulling", "")
	newDigest, err := u.docker.PullImage(ctx, imageRef)
	if err != nil {
		return &UpdateResult{
			ContainerID:   containerID,
			ContainerName: snapshot.Name,
			Success:       false,
			OldDigest:     snapshot.ImageDigest,
			Error:         fmt.Sprintf("pull failed: %v", err),
			DurationMs:    time.Since(start).Milliseconds(),
		}, err
	}

	// Re-acquire lock for the destructive stop/remove/create sequence
	entry = u.lockContainer(preSnap.Name)
	defer entry.mu.Unlock()

	// Re-inspect inside lock to verify container hasn't changed during pull
	snapshot, err = u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		return &UpdateResult{
			ContainerID: containerID,
			Success:     false,
			Error:       fmt.Sprintf("inspect failed after pull: %v", err),
			DurationMs:  time.Since(start).Milliseconds(),
		}, err
	}

	// 4. Pre-flight: verify all bind mount sources exist
	for _, bind := range snapshot.HostConfig.Binds {
		parts := strings.SplitN(bind, ":", 2)
		hostPath := parts[0]
		if strings.HasPrefix(hostPath, "/") {
			if _, err := os.Stat(hostPath); os.IsNotExist(err) {
				return &UpdateResult{
					ContainerID:   containerID,
					ContainerName: snapshot.Name,
					Success:       false,
					OldDigest:     snapshot.ImageDigest,
					Error:         fmt.Sprintf("bind mount source does not exist: %s", hostPath),
					DurationMs:    time.Since(start).Milliseconds(),
				}, fmt.Errorf("bind mount source does not exist: %s", hostPath)
			}
		}
	}

	// 5. Save snapshot BEFORE stop — ensures rollback data exists if agent crashes mid-update
	u.mu.Lock()
	u.snapshots[containerID] = snapshot
	u.snapshots[snapshot.Name] = snapshot
	u.mu.Unlock()
	saveSnapshot(containerID, snapshot)

	// 6. Stop old container
	u.emitProgress(containerID, snapshot.Name, "stopping", "")
	timeout := 30
	if err := u.docker.cli.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		return &UpdateResult{
			ContainerID:   containerID,
			ContainerName: snapshot.Name,
			Success:       false,
			OldDigest:     snapshot.ImageDigest,
			Error:         fmt.Sprintf("stop failed: %v", err),
			DurationMs:    time.Since(start).Milliseconds(),
		}, err
	}

	// 6. Remove old container (non-fatal if already gone, e.g. AutoRemove=true)
	u.emitProgress(containerID, snapshot.Name, "removing", "")
	if err := u.docker.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{}); err != nil {
		if !isNonFatalRemoveErr(err) {
			_ = u.docker.cli.ContainerStart(ctx, containerID, container.StartOptions{})
			return &UpdateResult{
				ContainerID:   containerID,
				ContainerName: snapshot.Name,
				Success:       false,
				OldDigest:     snapshot.ImageDigest,
				Error:         fmt.Sprintf("remove failed: %v", err),
				DurationMs:    time.Since(start).Milliseconds(),
			}, err
		}
		log.Printf("[update] ContainerRemove %s returned non-fatal error (container already gone): %v", containerID, err)
	}

	// 7. Create and start new container
	u.emitProgress(containerID, snapshot.Name, "starting", "")
	newID, err := u.docker.RecreateContainer(ctx, snapshot, snapshot.ImageRef)
	if err != nil {
		// Rollback: recreate with the OLD image digest, not the new one
		_, rollbackErr := u.docker.RecreateContainer(ctx, snapshot, snapshot.ImageDigest)
		errMsg := fmt.Sprintf("create failed: %v", err)
		if rollbackErr != nil {
			errMsg += fmt.Sprintf("; rollback also failed: %v", rollbackErr)
		}
		return &UpdateResult{
			ContainerID:   containerID,
			ContainerName: snapshot.Name,
			Success:       false,
			OldDigest:     snapshot.ImageDigest,
			Error:         errMsg,
			DurationMs:    time.Since(start).Milliseconds(),
		}, err
	}

	return &UpdateResult{
		ContainerID:   newID,
		ContainerName: snapshot.Name,
		Success:       true,
		OldDigest:     snapshot.ImageDigest,
		NewDigest:     newDigest,
		DurationMs:    time.Since(start).Milliseconds(),
	}, nil
}

// RollbackContainer restores a container from its stored snapshot.
func (u *Updater) RollbackContainer(ctx context.Context, containerID string) (*UpdateResult, error) {
	// Look up snapshot first to get canonical name for stable lock key — RC-02
	u.mu.RLock()
	snapshot, ok := u.snapshots[containerID]
	u.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("no snapshot found for container %s", containerID)
	}

	// RACE-01 + RC-02: lock by canonical name (stable across recreations)
	entry := u.lockContainer(snapshot.Name)
	defer entry.mu.Unlock()

	start := time.Now()

	timeout := 30
	_ = u.docker.cli.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &timeout})
	if err := u.docker.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{}); err != nil && !isNonFatalRemoveErr(err) {
		log.Printf("[rollback] ContainerRemove %s failed: %v", containerID, err)
	}

	newID, err := u.docker.RecreateContainer(ctx, snapshot, snapshot.ImageRef)
	if err != nil {
		return &UpdateResult{
			ContainerID:   containerID,
			ContainerName: snapshot.Name,
			Success:       false,
			Error:         fmt.Sprintf("rollback failed: %v", err),
			DurationMs:    time.Since(start).Milliseconds(),
			IsRollback:    true,
		}, err
	}

	return &UpdateResult{
		ContainerID:   newID,
		ContainerName: snapshot.Name,
		Success:       true,
		OldDigest:     snapshot.ImageDigest,
		DurationMs:    time.Since(start).Milliseconds(),
		IsRollback:    true,
	}, nil
}

// RollbackToImage rolls back a container to a specific image (tag or digest).
// progressID is the original container ID the UI tracks (may differ from containerID after recreation).
func (u *Updater) RollbackToImage(ctx context.Context, containerID string, targetImage string, progressID string) (*UpdateResult, error) {
	start := time.Now()

	// Resolve to canonical ID before locking — RC-01 + RC-02
	resolvedID, err := u.docker.ResolveContainerID(ctx, containerID)
	if err == nil {
		containerID = resolvedID
	}

	// Pre-inspect (outside lock) to get canonical name for stable lock key — RC-01 + RC-02
	preSnap, err := u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		originalID := progressID
		if originalID == "" {
			originalID = containerID
		}
		return &UpdateResult{
			ContainerID: originalID,
			Success:     false,
			Error:       fmt.Sprintf("inspect failed: %v", err),
			DurationMs:  time.Since(start).Milliseconds(),
			IsRollback:  true,
		}, err
	}

	// RC-01: RollbackToImage previously had no lock — now serializes with Update/Rollback.
	// RC-02: lock by canonical name (stable across recreations).
	entry := u.lockContainer(preSnap.Name)
	defer entry.mu.Unlock()

	originalID := progressID
	if originalID == "" {
		originalID = containerID
	}

	// FIX-1.1: re-inspect inside the lock to close the TOCTOU window between the
	// pre-inspect (outside lock) and actual use. The container may have been deleted
	// or recreated by a concurrent UPDATE between pre-inspect and lock acquisition.
	snapshot, err := u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		// Container disappeared — try resolving by name (it may have been recreated)
		resolvedID, resolveErr := u.docker.ResolveContainerID(ctx, preSnap.Name)
		if resolveErr != nil {
			return &UpdateResult{
				ContainerID: originalID,
				Success:     false,
				Error:       fmt.Sprintf("inspect failed (container gone): %v", err),
				DurationMs:  time.Since(start).Milliseconds(),
				IsRollback:  true,
			}, err
		}
		containerID = resolvedID
		snapshot, err = u.docker.InspectContainer(ctx, containerID)
		if err != nil {
			return &UpdateResult{
				ContainerID: originalID,
				Success:     false,
				Error:       fmt.Sprintf("inspect failed after resolve: %v", err),
				DurationMs:  time.Since(start).Milliseconds(),
				IsRollback:  true,
			}, err
		}
	}

	// 2. Pull target image (emit progress with originalID so UI can track it)
	u.emitProgress(originalID, snapshot.Name, "pulling", targetImage)
	newDigest, err := u.docker.PullImage(ctx, targetImage)
	if err != nil {
		return &UpdateResult{
			ContainerID:   originalID,
			ContainerName: snapshot.Name,
			Success:       false,
			Error:         fmt.Sprintf("pull failed: %v", err),
			DurationMs:    time.Since(start).Milliseconds(),
			IsRollback:    true,
		}, err
	}

	// 3. Stop + remove current
	u.emitProgress(originalID, snapshot.Name, "stopping", "")
	timeout := 30
	_ = u.docker.cli.ContainerStop(ctx, containerID, container.StopOptions{Timeout: &timeout})

	u.emitProgress(originalID, snapshot.Name, "removing", "")
	if err := u.docker.cli.ContainerRemove(ctx, containerID, container.RemoveOptions{}); err != nil && !isNonFatalRemoveErr(err) {
		log.Printf("[rollback-to-image] ContainerRemove %s failed: %v", containerID, err)
	}

	// 4. Recreate with target image
	u.emitProgress(originalID, snapshot.Name, "starting", "")
	_, err = u.docker.RecreateContainer(ctx, snapshot, targetImage)
	if err != nil {
		return &UpdateResult{
			ContainerID:   originalID,
			ContainerName: snapshot.Name,
			Success:       false,
			Error:         fmt.Sprintf("rollback to %s failed: %v", targetImage, err),
			DurationMs:    time.Since(start).Milliseconds(),
			IsRollback:    true,
		}, err
	}

	return &UpdateResult{
		ContainerID:   originalID,
		ContainerName: snapshot.Name,
		Success:       true,
		OldDigest:     snapshot.ImageDigest,
		NewDigest:     newDigest,
		DurationMs:    time.Since(start).Milliseconds(),
		IsRollback:    true,
	}, nil
}

// BlueGreenUpdate performs a zero-downtime update:
// start new container → verify health → stop old → rename new to original name.
func (u *Updater) BlueGreenUpdate(ctx context.Context, containerID string) (*UpdateResult, error) {
	start := time.Now()

	// Resolve to canonical ID before locking — RC-02
	resolvedID, err := u.docker.ResolveContainerID(ctx, containerID)
	if err == nil {
		containerID = resolvedID
	}

	// Pre-inspect (outside lock) to get canonical name for stable lock key — RC-02
	preSnap, err := u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		return &UpdateResult{ContainerID: containerID, Success: false,
			Error: fmt.Sprintf("inspect failed: %v", err), DurationMs: time.Since(start).Milliseconds()}, err
	}

	// RACE-01 + RC-02: lock by canonical name (stable across recreations)
	entry := u.lockContainer(preSnap.Name)
	defer entry.mu.Unlock()

	// 1. Snapshot current container (authoritative state inside the lock)
	snapshot, err := u.docker.InspectContainer(ctx, containerID)
	if err != nil {
		return &UpdateResult{ContainerID: containerID, Success: false,
			Error: fmt.Sprintf("inspect failed: %v", err), DurationMs: time.Since(start).Milliseconds()}, err
	}

	// 2. Verify image signature (if verifier is configured)
	if u.verifier != nil {
		if err := u.verifier.Verify(ctx, snapshot.ImageRef); err != nil {
			return &UpdateResult{ContainerID: containerID, ContainerName: snapshot.Name, Success: false,
				OldDigest: snapshot.ImageDigest, Error: err.Error(),
				DurationMs: time.Since(start).Milliseconds()}, err
		}
	}

	// 3. Pull new image
	u.emitProgress(containerID, snapshot.Name, "pulling", "")
	newDigest, err := u.docker.PullImage(ctx, snapshot.ImageRef)
	if err != nil {
		return &UpdateResult{ContainerID: containerID, ContainerName: snapshot.Name, Success: false,
			OldDigest: snapshot.ImageDigest, Error: fmt.Sprintf("pull failed: %v", err),
			DurationMs: time.Since(start).Milliseconds()}, err
	}

	// 4. Create new container with temp name
	tempName := snapshot.Name + "-ww-new"
	u.emitProgress(containerID, snapshot.Name, "starting", "blue-green")
	newID, err := u.docker.RecreateContainerNamed(ctx, snapshot, snapshot.ImageRef, tempName)
	if err != nil {
		return &UpdateResult{ContainerID: containerID, ContainerName: snapshot.Name, Success: false,
			OldDigest: snapshot.ImageDigest, Error: fmt.Sprintf("create new failed: %v", err),
			DurationMs: time.Since(start).Milliseconds()}, err
	}

	// 5. Wait for new container to be healthy.
	// Inspect the new container to check for healthcheck start_period and adjust timeout.
	healthTimeout := 60 * time.Second
	newInfo, inspErr := u.docker.cli.ContainerInspect(ctx, newID)
	if inspErr == nil && newInfo.Config != nil && newInfo.Config.Healthcheck != nil && newInfo.Config.Healthcheck.StartPeriod > 0 {
		healthTimeout += newInfo.Config.Healthcheck.StartPeriod
	}
	// Cap at 5 minutes total
	const maxHealthTimeout = 5 * time.Minute
	if healthTimeout > maxHealthTimeout {
		healthTimeout = maxHealthTimeout
	}
	healthy := u.waitForHealthy(ctx, newID, healthTimeout)
	if !healthy {
		// New container failed — clean it up using a fresh context (RC-04: the original
		// ctx may already be cancelled on WS disconnect, which would skip cleanup and
		// leave a duplicate *-ww-new container running on the host).
		cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanCancel()
		cleanTimeout := 10
		_ = u.docker.cli.ContainerStop(cleanCtx, newID, container.StopOptions{Timeout: &cleanTimeout})
		_ = u.docker.cli.ContainerRemove(cleanCtx, newID, container.RemoveOptions{})
		return &UpdateResult{ContainerID: containerID, ContainerName: snapshot.Name, Success: false,
			OldDigest: snapshot.ImageDigest,
			Error:     "new container failed health check; old container kept running",
			DurationMs: time.Since(start).Milliseconds()}, fmt.Errorf("health check failed")
	}

	// 6. Save snapshot before stopping old container (crash recovery)
	u.mu.Lock()
	u.snapshots[containerID] = snapshot
	u.snapshots[snapshot.Name] = snapshot
	u.mu.Unlock()
	saveSnapshot(containerID, snapshot)

	// 7. Stop and remove old container, rename new to original name
	// FIX-2.3: use a fresh context for cleanup so a cancelled parent ctx doesn't
	// leave the old container running alongside the new one. Log failures so
	// operators are aware of orphaned containers.
	u.emitProgress(containerID, snapshot.Name, "stopping", "")
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cleanupCancel()
	timeout := 30
	if err := u.docker.cli.ContainerStop(cleanupCtx, containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		log.Printf("[blue-green] warning: failed to stop old container %s: %v", containerID, err)
	}
	if err := u.docker.cli.ContainerRemove(cleanupCtx, containerID, container.RemoveOptions{}); err != nil {
		log.Printf("[blue-green] warning: failed to remove old container %s: %v", containerID, err)
	}

	// BUG-11 FIX: verify no container with the target name exists before rename.
	// An external `docker rename` or a race with another process could have created
	// a container with the same name, causing the rename to fail silently.
	if _, resolveErr := u.docker.ResolveContainerID(ctx, snapshot.Name); resolveErr == nil {
		log.Printf("[blue-green] warning: container with name %s already exists — skipping rename (possible external conflict)", snapshot.Name)
	} else if err := u.docker.ContainerRename(ctx, newID, snapshot.Name); err != nil {
		// Rename failed but new container is running — still a success
		log.Printf("[blue-green] rename failed (non-fatal): %v", err)
	}

	return &UpdateResult{
		ContainerID:   newID,
		ContainerName: snapshot.Name,
		Success:       true,
		OldDigest:     snapshot.ImageDigest,
		NewDigest:     newDigest,
		DurationMs:    time.Since(start).Milliseconds(),
	}, nil
}

// waitForHealthy polls ContainerInspect until the container is running and healthy.
// DOCKER-03: uses ctx-aware select so cancellation is respected immediately.
func (u *Updater) waitForHealthy(ctx context.Context, containerID string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		info, err := u.docker.cli.ContainerInspect(ctx, containerID)
		if err != nil {
			select {
			case <-ctx.Done():
				return false
			case <-time.After(2 * time.Second):
			}
			continue
		}
		status := info.State.Status
		if status == "exited" || status == "dead" {
			return false
		}
		if status == "running" {
			if info.State.Health != nil {
				switch info.State.Health.Status {
				case "healthy":
					return true
				case "unhealthy":
					return false
				// "starting" — keep waiting
				}
			} else {
				return true // No healthcheck — running is enough
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(2 * time.Second):
		}
	}
	return false
}
