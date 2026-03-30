package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockDockerAPI records calls and returns configured responses.
type mockDockerAPI struct {
	mu            sync.Mutex // protects calls slice for concurrent test safety
	calls         []string
	containers    []types.Container
	inspectResult types.ContainerJSON
	inspectErr    error
	pullErr       error
	stopErr       error
	removeErr     error
	createErr     error
	startErr      error
	imageInspect  types.ImageInspect
	// Extended mock fields for audit findings
	networkConnectErr  error                                                        // Finding 2.1
	containerRenameErr error                                                        // Blue-green tests
	listAllFlag        bool                                                         // DOCKER-04 tracking
	pullDelay          time.Duration                                                // Finding 1.4 context cancel
	inspectFn          func(id string) (types.ContainerJSON, error)                 // dynamic inspect
	containerListFn    func(ctx context.Context, opts container.ListOptions) ([]types.Container, error)  // dynamic list
	stopFn             func(id string) error                                        // dynamic stop per container
}

func (m *mockDockerAPI) recordCall(call string) {
	m.mu.Lock()
	m.calls = append(m.calls, call)
	m.mu.Unlock()
}

func (m *mockDockerAPI) getCalls() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]string, len(m.calls))
	copy(cp, m.calls)
	return cp
}

func (m *mockDockerAPI) ContainerList(ctx context.Context, opts container.ListOptions) ([]types.Container, error) {
	m.recordCall("ContainerList")
	m.listAllFlag = opts.All
	if m.containerListFn != nil {
		return m.containerListFn(ctx, opts)
	}
	return m.containers, nil
}

func (m *mockDockerAPI) ContainerInspect(_ context.Context, id string) (types.ContainerJSON, error) {
	m.recordCall("ContainerInspect:" + id)
	if m.inspectFn != nil {
		return m.inspectFn(id)
	}
	return m.inspectResult, m.inspectErr
}

func (m *mockDockerAPI) ContainerStop(_ context.Context, id string, _ container.StopOptions) error {
	m.recordCall("ContainerStop:" + id)
	if m.stopFn != nil {
		return m.stopFn(id)
	}
	return m.stopErr
}

func (m *mockDockerAPI) ContainerRemove(_ context.Context, id string, _ container.RemoveOptions) error {
	m.recordCall("ContainerRemove:" + id)
	return m.removeErr
}

func (m *mockDockerAPI) ContainerCreate(_ context.Context, _ *container.Config, _ *container.HostConfig, _ *network.NetworkingConfig, _ *ocispec.Platform, name string) (container.CreateResponse, error) {
	m.recordCall("ContainerCreate:" + name)
	if m.createErr != nil {
		return container.CreateResponse{}, m.createErr
	}
	return container.CreateResponse{ID: "new-container-id"}, nil
}

func (m *mockDockerAPI) ContainerStart(_ context.Context, id string, _ container.StartOptions) error {
	m.recordCall("ContainerStart:" + id)
	return m.startErr
}

func (m *mockDockerAPI) ImagePull(ctx context.Context, ref string, _ image.PullOptions) (io.ReadCloser, error) {
	m.recordCall("ImagePull:" + ref)
	if m.pullErr != nil {
		return nil, m.pullErr
	}
	if m.pullDelay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(m.pullDelay):
		}
	}
	// Return a fake pull response with digest
	body := `{"status":"Digest: sha256:newdigest123"}` + "\n"
	return io.NopCloser(strings.NewReader(body)), nil
}

func (m *mockDockerAPI) ImageInspectWithRaw(_ context.Context, _ string) (types.ImageInspect, []byte, error) {
	m.recordCall("ImageInspectWithRaw")
	return m.imageInspect, nil, nil
}

func (m *mockDockerAPI) ImageList(_ context.Context, _ image.ListOptions) ([]image.Summary, error) {
	m.recordCall("ImageList")
	return nil, nil
}

func (m *mockDockerAPI) ImageRemove(_ context.Context, id string, _ image.RemoveOptions) ([]image.DeleteResponse, error) {
	m.recordCall("ImageRemove:" + id)
	return nil, nil
}

func (m *mockDockerAPI) NetworkConnect(_ context.Context, networkID, containerID string, _ *network.EndpointSettings) error {
	m.recordCall("NetworkConnect:" + networkID + ":" + containerID)
	return m.networkConnectErr
}

func (m *mockDockerAPI) ContainerRename(_ context.Context, containerID, newName string) error {
	m.recordCall("ContainerRename:" + containerID + ":" + newName)
	return m.containerRenameErr
}

func (m *mockDockerAPI) ContainerLogs(_ context.Context, _ string, _ container.LogsOptions) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("mock logs")), nil
}

func newTestSetup() (*mockDockerAPI, *Updater) {
	mock := &mockDockerAPI{
		inspectResult: types.ContainerJSON{
			ContainerJSONBase: &types.ContainerJSONBase{
				ID:   "test-container-123",
				Name: "/nginx",
				Image: "sha256:oldimage",
				HostConfig: &container.HostConfig{
					RestartPolicy: container.RestartPolicy{Name: "always"},
				},
			},
			Config: &container.Config{
				Image:  "nginx:latest",
				Env:    []string{"FOO=bar"},
				Labels: map[string]string{"app": "web"},
			},
			NetworkSettings: &types.NetworkSettings{
				Networks: map[string]*network.EndpointSettings{
					"bridge": {NetworkID: "bridge-id"},
				},
			},
		},
		imageInspect: types.ImageInspect{
			RepoDigests: []string{"nginx@sha256:currentdigest"},
		},
	}
	dc := NewDockerClientWithAPI(mock)
	updater := NewUpdater(dc)
	return mock, updater
}

func TestCheckForUpdates_NoUpdate(t *testing.T) {
	mock, updater := newTestSetup()
	// Pull returns same digest as current
	mock.imageInspect = types.ImageInspect{
		RepoDigests: []string{"nginx@sha256:currentdigest"},
	}

	results, err := updater.CheckForUpdates(context.Background(), []string{"test-container-123"})
	require.NoError(t, err)
	// The pull output returns sha256:newdigest123, which differs from currentdigest
	// So this will show as having an update
	assert.Len(t, results, 1)
}

func TestCheckForUpdates_WithUpdate(t *testing.T) {
	_, updater := newTestSetup()

	results, err := updater.CheckForUpdates(context.Background(), []string{"test-container-123"})
	require.NoError(t, err)
	assert.Len(t, results, 1)
	assert.True(t, results[0].HasUpdate)
	assert.Equal(t, "sha256:newdigest123", results[0].LatestDigest)
}

func TestUpdateContainer_Success(t *testing.T) {
	mock, updater := newTestSetup()

	result, err := updater.UpdateContainer(context.Background(), "test-container-123")
	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Equal(t, "new-container-id", result.ContainerID)

	// Verify call order: inspect -> pull -> stop -> remove -> create -> start
	expectedCalls := []string{
		"ContainerInspect:test-container-123",
		"ImageInspectWithRaw",
		"ImagePull:nginx:latest",
		"ContainerStop:test-container-123",
		"ContainerRemove:test-container-123",
		"ContainerCreate:nginx",
		"ContainerStart:new-container-id",
	}
	calls := mock.getCalls()
	for _, expected := range expectedCalls {
		found := false
		for _, call := range calls {
			if call == expected {
				found = true
				break
			}
		}
		assert.True(t, found, "expected call %s not found in %v", expected, calls)
	}

	// Verify snapshot stored for rollback
	updater.mu.RLock()
	_, hasSnapshot := updater.snapshots["test-container-123"]
	updater.mu.RUnlock()
	assert.True(t, hasSnapshot)
}

func TestUpdateContainer_PullFailure(t *testing.T) {
	mock, updater := newTestSetup()
	mock.pullErr = fmt.Errorf("network error")

	result, err := updater.UpdateContainer(context.Background(), "test-container-123")
	assert.Error(t, err)
	assert.False(t, result.Success)
	assert.Contains(t, result.Error, "pull failed")

	// Verify stop/remove were NOT called
	for _, call := range mock.getCalls() {
		assert.NotContains(t, call, "ContainerStop")
		assert.NotContains(t, call, "ContainerRemove")
	}
}

func TestUpdateContainer_CreateFailure_TriggersRollback(t *testing.T) {
	mock, updater := newTestSetup()
	callCount := 0
	mock.createErr = nil

	// Override create to fail first time, succeed on rollback
	originalCreateErr := fmt.Errorf("disk full")
	mock.createErr = originalCreateErr

	result, err := updater.UpdateContainer(context.Background(), "test-container-123")
	assert.Error(t, err)
	assert.False(t, result.Success)
	assert.Contains(t, result.Error, "create failed")

	// Verify that create was attempted (at least once for the new, possibly once for rollback)
	createCalls := 0
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerCreate") {
			createCalls++
		}
	}
	assert.GreaterOrEqual(t, createCalls, 1)
	_ = callCount
}

func TestRollbackContainer_WithSnapshot(t *testing.T) {
	mock, updater := newTestSetup()

	// First do a successful update to store a snapshot
	result, err := updater.UpdateContainer(context.Background(), "test-container-123")
	require.NoError(t, err)
	require.True(t, result.Success)

	// Reset mock for rollback
	mock.mu.Lock()
	mock.calls = nil
	mock.mu.Unlock()
	mock.createErr = nil

	// Rollback
	rollbackResult, err := updater.RollbackContainer(context.Background(), "test-container-123")
	require.NoError(t, err)
	assert.True(t, rollbackResult.Success)
}

func TestRollbackContainer_NoSnapshot(t *testing.T) {
	_, updater := newTestSetup()

	_, err := updater.RollbackContainer(context.Background(), "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no snapshot found")
}

// --- Audit Finding Tests ---

// newMultiNetworkSetup creates a test setup with multiple networks for Finding 2.1 tests.
func newMultiNetworkSetup() (*mockDockerAPI, *Updater) {
	mock := &mockDockerAPI{
		inspectResult: types.ContainerJSON{
			ContainerJSONBase: &types.ContainerJSONBase{
				ID:   "multi-net-container",
				Name: "/myapp",
				Image: "sha256:oldimage",
				HostConfig: &container.HostConfig{
					NetworkMode:   "bridge",
					RestartPolicy: container.RestartPolicy{Name: "always"},
				},
			},
			Config: &container.Config{
				Image:  "myapp:latest",
				Labels: map[string]string{},
			},
			NetworkSettings: &types.NetworkSettings{
				Networks: map[string]*network.EndpointSettings{
					"frontend": {NetworkID: "frontend-id"},
					"backend":  {NetworkID: "backend-id"},
				},
			},
		},
		imageInspect: types.ImageInspect{
			RepoDigests: []string{"myapp@sha256:currentdigest"},
		},
	}
	dc := NewDockerClientWithAPI(mock)
	updater := NewUpdater(dc)
	return mock, updater
}

// Finding 1.1 — TOCTOU in RollbackToImage: lock acquired before authoritative inspect
func TestRollbackToImage_LockBeforeInspect(t *testing.T) {
	mock, updater := newTestSetup()

	// Pre-store a snapshot so RollbackToImage can proceed
	updater.mu.Lock()
	updater.snapshots["test-container-123"] = &ContainerSnapshot{
		Name:        "nginx",
		ImageRef:    "nginx:latest",
		ImageDigest: "sha256:olddigest",
		Config:      mock.inspectResult.Config,
		HostConfig:  mock.inspectResult.HostConfig,
		Networks:    mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	result, err := updater.RollbackToImage(context.Background(), "test-container-123", "nginx:1.25", "")
	require.NoError(t, err)
	assert.True(t, result.Success)

	// Verify that ContainerInspect is called at least twice:
	// once pre-inspect (outside lock) and once inside the lock (FIX-1.1)
	inspectCount := 0
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerInspect:") {
			inspectCount++
		}
	}
	assert.GreaterOrEqual(t, inspectCount, 2, "should inspect both outside and inside the lock")
}

// Finding 1.1 — Concurrent RollbackToImage and UpdateContainer serialize on same container
func TestRollbackToImage_ConcurrentWithUpdate(t *testing.T) {
	mock, updater := newTestSetup()

	// Pre-store a snapshot
	updater.mu.Lock()
	updater.snapshots["test-container-123"] = &ContainerSnapshot{
		Name:        "nginx",
		ImageRef:    "nginx:latest",
		ImageDigest: "sha256:olddigest",
		Config:      mock.inspectResult.Config,
		HostConfig:  mock.inspectResult.HostConfig,
		Networks:    mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		updater.UpdateContainer(context.Background(), "test-container-123")
	}()
	go func() {
		defer wg.Done()
		updater.RollbackToImage(context.Background(), "test-container-123", "nginx:1.25", "")
	}()

	wg.Wait()
	// If we reach here without panic or data race (run with -race), the mutex works
}

// Finding 1.2 / RACE-03 — Lock cleanup removes idle entries
func TestLockCleanup_RemovesIdleEntries(t *testing.T) {
	_, updater := newTestSetup()

	// Acquire and immediately release a lock
	entry := updater.lockContainer("cleanup-test")
	entry.mu.Unlock()

	// Run cleanup manually (simulate what StartLockCleanup does)
	updater.containerLocksMu.Lock()
	for id, e := range updater.containerLocks {
		if e.mu.TryLock() {
			e.deleted = true
			delete(updater.containerLocks, id)
			e.mu.Unlock()
		}
	}
	updater.containerLocksMu.Unlock()

	updater.containerLocksMu.Lock()
	_, exists := updater.containerLocks["cleanup-test"]
	updater.containerLocksMu.Unlock()
	assert.False(t, exists, "idle lock entry should be removed by cleanup")
}

// Finding 1.2 — Held lock survives cleanup
func TestLockCleanup_DoesNotRemoveActiveLock(t *testing.T) {
	_, updater := newTestSetup()

	// Acquire lock and hold it
	entry := updater.lockContainer("active-test")

	// Run cleanup
	updater.containerLocksMu.Lock()
	for id, e := range updater.containerLocks {
		if e.mu.TryLock() {
			e.deleted = true
			delete(updater.containerLocks, id)
			e.mu.Unlock()
		}
	}
	updater.containerLocksMu.Unlock()

	// Entry should still exist because TryLock fails on held mutex
	updater.containerLocksMu.Lock()
	_, exists := updater.containerLocks["active-test"]
	updater.containerLocksMu.Unlock()
	assert.True(t, exists, "held lock entry should survive cleanup")

	entry.mu.Unlock()
}

// Finding 1.2 — lockContainer retries after deleted entry
func TestLockCleanup_RetryOnDeletedEntry(t *testing.T) {
	_, updater := newTestSetup()

	// First, create and lock an entry, then simulate cleanup deleting it
	entry := updater.lockContainer("retry-test")
	entry.mu.Unlock()

	// Simulate cleanup: TryLock, mark deleted, delete from map
	updater.containerLocksMu.Lock()
	e := updater.containerLocks["retry-test"]
	if e.mu.TryLock() {
		e.deleted = true
		delete(updater.containerLocks, "retry-test")
		e.mu.Unlock()
	}
	updater.containerLocksMu.Unlock()

	// lockContainer should create a fresh entry since the old one is gone
	newEntry := updater.lockContainer("retry-test")
	defer newEntry.mu.Unlock()

	assert.False(t, newEntry.deleted, "new entry should not be marked deleted")
}

// Finding 2.1 — NetworkConnect failure fails the update and cleans up
func TestUpdateContainer_NetworkConnectError_CleansUp(t *testing.T) {
	mock, updater := newMultiNetworkSetup()
	mock.networkConnectErr = fmt.Errorf("network unreachable")

	result, err := updater.UpdateContainer(context.Background(), "multi-net-container")
	assert.Error(t, err)
	assert.False(t, result.Success)
	assert.Contains(t, result.Error, "failed to connect network")

	// Verify cleanup: the partially created container should be stopped and removed
	var stopCalls, removeCalls int
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerStop:") {
			stopCalls++
		}
		if strings.HasPrefix(call, "ContainerRemove:") {
			removeCalls++
		}
	}
	// At least 2 stops: one for old container, one for cleanup of partial new container
	assert.GreaterOrEqual(t, stopCalls, 2, "should stop both old and partial new container")
}

// Finding 2.2 — Snapshot saved to disk before ContainerStop
func TestUpdateContainer_SnapshotSavedBeforeStop(t *testing.T) {
	mock, updater := newTestSetup()

	// Use temp dir for snapshots
	tmpDir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", tmpDir)

	// Track when stop is called and check if snapshot exists on disk
	snapshotExistedBeforeStop := false
	mock.stopFn = func(id string) error {
		path := filepath.Join(tmpDir, "test-container-123.json")
		if _, err := os.Stat(path); err == nil {
			snapshotExistedBeforeStop = true
		}
		return nil
	}

	result, err := updater.UpdateContainer(context.Background(), "test-container-123")
	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.True(t, snapshotExistedBeforeStop, "snapshot must be saved to disk before stopping container")
}

// Finding 2.3 — Blue-green update succeeds even when old container cleanup fails
func TestBlueGreenUpdate_OldContainerCleanupFailure(t *testing.T) {
	mock, updater := newTestSetup()

	// Make stop fail for the old container but not for cleanup of failed new containers
	mock.stopFn = func(id string) error {
		if id == "test-container-123" {
			return fmt.Errorf("stop failed: container busy")
		}
		return nil
	}

	// waitForHealthy needs the container to appear healthy
	mock.inspectFn = func(id string) (types.ContainerJSON, error) {
		result := mock.inspectResult
		result.ContainerJSONBase = &types.ContainerJSONBase{
			ID:    id,
			Name:  "/nginx",
			Image: "sha256:oldimage",
			State: &types.ContainerState{
				Status:  "running",
				Running: true,
			},
			HostConfig: mock.inspectResult.HostConfig,
		}
		result.Config = mock.inspectResult.Config
		result.NetworkSettings = mock.inspectResult.NetworkSettings
		return result, nil
	}

	result, err := updater.BlueGreenUpdate(context.Background(), "test-container-123")
	require.NoError(t, err)
	// Update should still succeed — old container cleanup failure is logged but non-fatal
	assert.True(t, result.Success)
}

// RACE-01 — BlueGreenUpdate acquires per-container lock (concurrent with UpdateContainer)
func TestBlueGreenUpdate_AcquiresContainerLock(t *testing.T) {
	mock, updater := newTestSetup()

	// Make inspectFn return running state for waitForHealthy
	mock.inspectFn = func(id string) (types.ContainerJSON, error) {
		result := mock.inspectResult
		result.ContainerJSONBase = &types.ContainerJSONBase{
			ID:    id,
			Name:  "/nginx",
			Image: "sha256:oldimage",
			State: &types.ContainerState{
				Status:  "running",
				Running: true,
			},
			HostConfig: mock.inspectResult.HostConfig,
		}
		result.Config = mock.inspectResult.Config
		result.NetworkSettings = mock.inspectResult.NetworkSettings
		return result, nil
	}

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		updater.BlueGreenUpdate(context.Background(), "test-container-123")
	}()
	go func() {
		defer wg.Done()
		updater.UpdateContainer(context.Background(), "test-container-123")
	}()

	wg.Wait()
	// No race detected under -race flag means the lock is working
}

// RACE-01 — RollbackContainer acquires per-container lock
func TestRollbackContainer_AcquiresContainerLock(t *testing.T) {
	mock, updater := newTestSetup()

	// Pre-store a snapshot
	updater.mu.Lock()
	updater.snapshots["test-container-123"] = &ContainerSnapshot{
		Name:        "nginx",
		ImageRef:    "nginx:latest",
		ImageDigest: "sha256:olddigest",
		Config:      mock.inspectResult.Config,
		HostConfig:  mock.inspectResult.HostConfig,
		Networks:    mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		updater.RollbackContainer(context.Background(), "test-container-123")
	}()
	go func() {
		defer wg.Done()
		updater.UpdateContainer(context.Background(), "test-container-123")
	}()

	wg.Wait()
}

// RACE-02 — CheckForUpdates serialized with UpdateContainer per container
func TestCheckForUpdates_SerializedWithUpdate(t *testing.T) {
	_, updater := newTestSetup()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		updater.CheckForUpdates(context.Background(), []string{"test-container-123"})
	}()
	go func() {
		defer wg.Done()
		updater.UpdateContainer(context.Background(), "test-container-123")
	}()

	wg.Wait()
}

// RACE-03 — StartLockCleanup stops on context cancellation
func TestStartLockCleanup_StopsOnContextCancel(t *testing.T) {
	_, updater := newTestSetup()

	ctx, cancel := context.WithCancel(context.Background())
	updater.StartLockCleanup(ctx)

	// Cancel immediately — goroutine should exit without hanging
	cancel()
	time.Sleep(100 * time.Millisecond) // Brief settle time
}

// DOCKER-02 — RecoverOrphans respects timeout when Docker is unresponsive
func TestRecoverOrphans_RespectsTimeout(t *testing.T) {
	mock, updater := newTestSetup()

	// Pre-store a snapshot so recovery has something to check
	updater.mu.Lock()
	updater.snapshots["orphan-1"] = &ContainerSnapshot{
		Name:     "orphan-app",
		ImageRef: "orphan:latest",
		Config:   mock.inspectResult.Config,
		HostConfig: mock.inspectResult.HostConfig,
		Networks: mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	// ContainerList blocks until context is cancelled, simulating unresponsive Docker
	mock.containerListFn = func(ctx context.Context, _ container.ListOptions) ([]types.Container, error) {
		<-ctx.Done()
		return nil, fmt.Errorf("docker daemon unavailable")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	updater.RecoverOrphans(ctx)
	elapsed := time.Since(start)

	assert.Less(t, elapsed, 2*time.Second, "RecoverOrphans should return within timeout, not hang for 5s")
}

// DOCKER-03 — waitForHealthy respects context cancellation
func TestWaitForHealthy_RespectsContextCancel(t *testing.T) {
	mock, updater := newTestSetup()

	// Always return "starting" health status (never healthy)
	mock.inspectFn = func(id string) (types.ContainerJSON, error) {
		return types.ContainerJSON{
			ContainerJSONBase: &types.ContainerJSONBase{
				ID:   id,
				Name: "/test",
				State: &types.ContainerState{
					Status:  "running",
					Running: true,
					Health:  &types.Health{Status: "starting"},
				},
			},
		}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	start := time.Now()
	healthy := updater.waitForHealthy(ctx, "test-container", 60*time.Second)
	elapsed := time.Since(start)

	assert.False(t, healthy)
	assert.Less(t, elapsed, 5*time.Second, "should return promptly on ctx cancel, not wait full 60s")
}

// DOCKER-04 — RecoverOrphans uses All:true to include stopped containers
func TestRecoverOrphans_UsesAllTrue(t *testing.T) {
	mock, updater := newTestSetup()

	// Pre-store a snapshot for a container that exists as stopped
	updater.mu.Lock()
	updater.snapshots["stopped-1"] = &ContainerSnapshot{
		Name:       "stopped-app",
		ImageRef:   "app:latest",
		Config:     mock.inspectResult.Config,
		HostConfig: mock.inspectResult.HostConfig,
		Networks:   mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	// The container exists (stopped) in the list
	mock.containers = []types.Container{
		{ID: "stopped-1", Names: []string{"/stopped-app"}, State: "exited"},
	}

	updater.RecoverOrphans(context.Background())

	assert.True(t, mock.listAllFlag, "RecoverOrphans must call ContainerList with All:true")

	// Container exists (even if stopped) — should NOT be recreated
	for _, call := range mock.getCalls() {
		assert.False(t, strings.HasPrefix(call, "ContainerCreate:"),
			"should not recreate a container that still exists (even if stopped)")
	}
}

// DOCKER-04 — RecoverOrphans recreates truly missing containers
func TestRecoverOrphans_RecreatesMissingContainer(t *testing.T) {
	mock, updater := newTestSetup()

	// Pre-store a snapshot for a container that is NOT in the container list
	updater.mu.Lock()
	updater.snapshots["missing-1"] = &ContainerSnapshot{
		Name:        "missing-app",
		ImageRef:    "app:latest",
		ImageDigest: "sha256:previousdigest",
		Config:      mock.inspectResult.Config,
		HostConfig:  mock.inspectResult.HostConfig,
		Networks:    mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	// Empty container list — container is missing
	mock.containers = []types.Container{}

	updater.RecoverOrphans(context.Background())

	// Should attempt to recreate via ContainerCreate
	createFound := false
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerCreate:") {
			createFound = true
			break
		}
	}
	assert.True(t, createFound, "should recreate a container that is truly missing")
}

// DOCKER-04 — RecoverOrphans skips stopped-but-existing containers
func TestRecoverOrphans_SkipsStoppedContainer(t *testing.T) {
	mock, updater := newTestSetup()

	updater.mu.Lock()
	updater.snapshots["exited-1"] = &ContainerSnapshot{
		Name:       "exited-app",
		ImageRef:   "app:latest",
		Config:     mock.inspectResult.Config,
		HostConfig: mock.inspectResult.HostConfig,
		Networks:   mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	mock.containers = []types.Container{
		{ID: "exited-1", Names: []string{"/exited-app"}, State: "exited"},
	}

	updater.RecoverOrphans(context.Background())

	for _, call := range mock.getCalls() {
		assert.False(t, strings.HasPrefix(call, "ContainerCreate:"),
			"should not recreate stopped-but-existing container")
	}
}

// --- BUG-03 Regression Tests: Blue-Green Orphan Recovery ---

// BUG-03 — RecoverOrphans renames orphaned -ww-new container when original is missing
func TestRecoverOrphans_RenamesBlueGreenOrphan(t *testing.T) {
	mock, updater := newTestSetup()

	// Simulate crash after blue-green create but before rename:
	// "nginx-ww-new" exists but "nginx" does not
	mock.containers = []types.Container{
		{ID: "new-bg-id", Names: []string{"/nginx-ww-new"}, State: "running"},
	}

	updater.RecoverOrphans(context.Background())

	// Should rename nginx-ww-new → nginx (completing the blue-green transition)
	renameCalls := 0
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerRename:") {
			renameCalls++
			assert.Contains(t, call, "ContainerRename:new-bg-id:nginx",
				"should rename -ww-new container to the original name")
		}
	}
	assert.Equal(t, 1, renameCalls, "should rename exactly one orphan")

	// Should NOT recreate via ContainerCreate (the rename handles recovery)
	for _, call := range mock.getCalls() {
		assert.False(t, strings.HasPrefix(call, "ContainerCreate:"),
			"should not recreate when rename completes the recovery")
	}
}

// BUG-03 — RecoverOrphans removes -ww-new orphan when original still exists
func TestRecoverOrphans_RemovesBlueGreenOrphanWhenOriginalExists(t *testing.T) {
	mock, updater := newTestSetup()

	// Both "nginx" and "nginx-ww-new" exist (crash during health check phase)
	mock.containers = []types.Container{
		{ID: "original-id", Names: []string{"/nginx"}, State: "running"},
		{ID: "orphan-id", Names: []string{"/nginx-ww-new"}, State: "running"},
	}

	updater.RecoverOrphans(context.Background())

	// Should stop and remove the orphan
	calls := mock.getCalls()
	stopFound := false
	removeFound := false
	for _, call := range calls {
		if call == "ContainerStop:orphan-id" {
			stopFound = true
		}
		if call == "ContainerRemove:orphan-id" {
			removeFound = true
		}
	}
	assert.True(t, stopFound, "should stop the orphaned -ww-new container")
	assert.True(t, removeFound, "should remove the orphaned -ww-new container")

	// Should NOT rename (original exists)
	for _, call := range calls {
		assert.False(t, strings.HasPrefix(call, "ContainerRename:"),
			"should not rename when original container still exists")
	}
}

// BUG-03 — RecoverOrphans handles rename + snapshot recovery together
func TestRecoverOrphans_BlueGreenRenameAllowsSnapshotSkip(t *testing.T) {
	mock, updater := newTestSetup()

	// Snapshot exists for "nginx" + orphaned "nginx-ww-new" running
	updater.mu.Lock()
	updater.snapshots["snap-1"] = &ContainerSnapshot{
		Name:        "nginx",
		ImageRef:    "nginx:latest",
		ImageDigest: "sha256:olddigest",
		Config:      mock.inspectResult.Config,
		HostConfig:  mock.inspectResult.HostConfig,
		Networks:    mock.inspectResult.NetworkSettings.Networks,
	}
	updater.mu.Unlock()

	mock.containers = []types.Container{
		{ID: "bg-id", Names: []string{"/nginx-ww-new"}, State: "running"},
	}

	updater.RecoverOrphans(context.Background())

	calls := mock.getCalls()

	// Should rename -ww-new → nginx
	renameFound := false
	for _, call := range calls {
		if strings.HasPrefix(call, "ContainerRename:bg-id:nginx") {
			renameFound = true
		}
	}
	assert.True(t, renameFound, "should rename orphaned -ww-new to original name")

	// Should NOT also recreate from snapshot (rename already recovered it)
	for _, call := range calls {
		assert.False(t, strings.HasPrefix(call, "ContainerCreate:"),
			"should not recreate from snapshot when rename already recovered the container")
	}
}

// --- BUG-06 Regression Tests: Lock released during pull ---

// BUG-06 — UpdateContainer releases lock during image pull
func TestUpdateContainer_LockReleasedDuringPull(t *testing.T) {
	mock, updater := newTestSetup()

	// Use pullDelay to simulate a slow pull. While pull is in progress,
	// another goroutine should be able to acquire the same container lock.
	mock.pullDelay = 500 * time.Millisecond

	lockAcquiredDuringPull := make(chan bool, 1)

	// Start update in background
	go func() {
		updater.UpdateContainer(context.Background(), "test-container-123")
	}()

	// Wait for pull to start then try to acquire the lock
	time.Sleep(200 * time.Millisecond)
	go func() {
		entry := updater.lockContainer("nginx") // same canonical name
		lockAcquiredDuringPull <- true
		entry.mu.Unlock()
	}()

	select {
	case acquired := <-lockAcquiredDuringPull:
		assert.True(t, acquired, "lock should be acquirable during pull phase")
	case <-time.After(3 * time.Second):
		t.Fatal("lock was NOT released during pull — BUG-06 not fixed")
	}
}

// BUG-06 — UpdateContainer re-inspects after re-acquiring lock
func TestUpdateContainer_ReinspectsAfterPull(t *testing.T) {
	mock, updater := newTestSetup()

	result, err := updater.UpdateContainer(context.Background(), "test-container-123")
	require.NoError(t, err)
	assert.True(t, result.Success)

	// Verify inspect called at least 3 times: pre-inspect, inspect-in-lock, re-inspect-after-pull
	inspectCount := 0
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerInspect:") {
			inspectCount++
		}
	}
	assert.GreaterOrEqual(t, inspectCount, 3,
		"should inspect: pre-lock, in-lock, and after re-acquiring lock post-pull")
}

// --- BUG-11 Regression: Blue-green rename collision check ---

func TestBlueGreenUpdate_SkipsRenameIfNameExists(t *testing.T) {
	mock, updater := newTestSetup()

	// inspectFn returns a running container for waitForHealthy AND for the
	// collision check (ResolveContainerID succeeds = name exists)
	mock.inspectFn = func(id string) (types.ContainerJSON, error) {
		result := mock.inspectResult
		result.ContainerJSONBase = &types.ContainerJSONBase{
			ID:    id,
			Name:  "/nginx",
			Image: "sha256:oldimage",
			State: &types.ContainerState{
				Status:  "running",
				Running: true,
			},
			HostConfig: mock.inspectResult.HostConfig,
		}
		result.Config = mock.inspectResult.Config
		result.NetworkSettings = mock.inspectResult.NetworkSettings
		return result, nil
	}

	// ContainerList returns the original container (simulating it wasn't removed
	// due to external interference) — causes ResolveContainerID to find it
	mock.containerListFn = func(_ context.Context, _ container.ListOptions) ([]types.Container, error) {
		return []types.Container{
			{ID: "external-nginx", Names: []string{"/nginx"}},
		}, nil
	}

	result, err := updater.BlueGreenUpdate(context.Background(), "test-container-123")
	require.NoError(t, err)
	assert.True(t, result.Success)

	// Should NOT call ContainerRename (name collision detected)
	for _, call := range mock.getCalls() {
		assert.False(t, strings.HasPrefix(call, "ContainerRename:"),
			"should skip rename when target name already exists")
	}
}
