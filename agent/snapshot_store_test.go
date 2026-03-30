package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeTestSnapshot(name, imageRef string) *ContainerSnapshot {
	return &ContainerSnapshot{
		Name:        name,
		ImageRef:    imageRef,
		ImageDigest: "sha256:abc123def456",
		Config: &container.Config{
			Image: imageRef,
			Env:   []string{"FOO=bar", "BAZ=qux"},
		},
		HostConfig: &container.HostConfig{
			RestartPolicy: container.RestartPolicy{Name: "always"},
		},
		Networks: map[string]*network.EndpointSettings{
			"bridge": {NetworkID: "bridge-net-id"},
		},
	}
}

func TestSaveAndLoadSnapshot(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", dir)

	snap := makeTestSnapshot("my-app", "myrepo/myapp:latest")
	saveSnapshot("container-abc", snap)

	// File should exist
	path := filepath.Join(dir, "container-abc.json")
	_, err := os.Stat(path)
	require.NoError(t, err, "snapshot file should exist after save")

	// Load it back
	loaded := make(map[string]*ContainerSnapshot)
	loadSnapshots(loaded)

	require.Contains(t, loaded, "container-abc")
	got := loaded["container-abc"]
	assert.Equal(t, snap.Name, got.Name)
	assert.Equal(t, snap.ImageRef, got.ImageRef)
	assert.Equal(t, snap.ImageDigest, got.ImageDigest)
	require.NotNil(t, got.Config)
	assert.Equal(t, snap.Config.Image, got.Config.Image)
	assert.Equal(t, snap.Config.Env, got.Config.Env)
	require.NotNil(t, got.HostConfig)
	assert.Equal(t, snap.HostConfig.RestartPolicy.Name, got.HostConfig.RestartPolicy.Name)
	require.NotNil(t, got.Networks)
	assert.Contains(t, got.Networks, "bridge")
}

func TestLoadSnapshots_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", dir)

	loaded := make(map[string]*ContainerSnapshot)
	loadSnapshots(loaded) // should not panic or error
	assert.Empty(t, loaded)
}

func TestLoadSnapshots_NonExistentDir(t *testing.T) {
	t.Setenv("SNAPSHOT_DIR", "/tmp/watchwarden-no-such-dir-xyz")

	loaded := make(map[string]*ContainerSnapshot)
	loadSnapshots(loaded) // should silently return
	assert.Empty(t, loaded)
}

func TestSaveMultipleSnapshotsAndLoadAll(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", dir)

	saveSnapshot("c1", makeTestSnapshot("app1", "app1:v1"))
	saveSnapshot("c2", makeTestSnapshot("app2", "app2:v2"))
	saveSnapshot("c3", makeTestSnapshot("app3", "app3:v3"))

	loaded := make(map[string]*ContainerSnapshot)
	loadSnapshots(loaded)

	assert.Len(t, loaded, 3)
	assert.Equal(t, "app1", loaded["c1"].Name)
	assert.Equal(t, "app2", loaded["c2"].Name)
	assert.Equal(t, "app3", loaded["c3"].Name)
}

func TestDeleteSnapshot(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", dir)

	saveSnapshot("c-del", makeTestSnapshot("todelete", "img:latest"))

	path := filepath.Join(dir, "c-del.json")
	_, err := os.Stat(path)
	require.NoError(t, err)

	deleteSnapshot("c-del")

	_, err = os.Stat(path)
	assert.True(t, os.IsNotExist(err), "file should be removed after deleteSnapshot")
}

func TestNewUpdaterLoadsExistingSnapshots(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", dir)

	// Pre-seed a snapshot on disk
	saveSnapshot("pre-existing", makeTestSnapshot("nginx", "nginx:latest"))

	// NewUpdater should pick it up
	mock := &mockDockerAPI{}
	dc := &DockerClient{cli: mock}
	updater := NewUpdater(dc)

	updater.mu.RLock()
	snap, ok := updater.snapshots["pre-existing"]
	updater.mu.RUnlock()

	require.True(t, ok, "pre-existing snapshot should be loaded by NewUpdater")
	assert.Equal(t, "nginx", snap.Name)
	assert.Equal(t, "nginx:latest", snap.ImageRef)
}

func TestSnapshotFilePermissions(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SNAPSHOT_DIR", dir)

	saveSnapshot("perm-test", makeTestSnapshot("app", "app:latest"))

	info, err := os.Stat(filepath.Join(dir, "perm-test.json"))
	require.NoError(t, err)
	// File should be owner-only readable (0600)
	assert.Equal(t, os.FileMode(0600), info.Mode().Perm())
}
