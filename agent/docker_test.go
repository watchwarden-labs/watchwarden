package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Finding 1.4 — PullImage returns promptly when context is cancelled
func TestPullImage_ContextCancelStopsRead(t *testing.T) {
	mock := &mockDockerAPI{
		pullDelay: 10 * time.Second, // Simulate very slow pull
		imageInspect: image.InspectResponse{
			RepoDigests: []string{"nginx@sha256:test"},
		},
	}
	dc := NewDockerClientWithAPI(mock)

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := dc.PullImage(ctx, "nginx:latest")
	elapsed := time.Since(start)

	assert.Error(t, err, "PullImage should return error on context cancel")
	assert.Less(t, elapsed, 3*time.Second, "should return promptly, not wait for pull to complete")
}

// Per-container policy label is read from Docker labels
func TestListContainers_ReadsPolicy(t *testing.T) {
	mock := &mockDockerAPI{
		containers: []container.Summary{
			{
				ID:     "container-with-policy-id",
				Names:  []string{"/myapp"},
				Image:  "myapp:latest",
				State:  "running",
				Labels: map[string]string{
					"com.watchwarden.policy": "manual",
				},
			},
		},
		imageInspect: image.InspectResponse{
			RepoDigests: []string{"myapp@sha256:test"},
		},
	}
	dc := NewDockerClientWithAPI(mock)
	containers, err := dc.ListContainers(context.Background())
	require.NoError(t, err)
	require.Len(t, containers, 1)
	assert.Equal(t, "manual", containers[0].Policy)
}

// Finding 2.1 — RecreateContainer with multiple networks calls NetworkConnect
func TestRecreateContainer_MultiNetwork(t *testing.T) {
	mock := &mockDockerAPI{
		imageInspect: image.InspectResponse{
			RepoDigests: []string{"myapp@sha256:test"},
		},
	}
	dc := NewDockerClientWithAPI(mock)

	snapshot := &ContainerSnapshot{
		Name:     "myapp",
		ImageRef: "myapp:latest",
		Config:   &container.Config{Image: "myapp:latest"},
		HostConfig: &container.HostConfig{
			NetworkMode:   "bridge",
			RestartPolicy: container.RestartPolicy{Name: "always"},
		},
		Networks: map[string]*network.EndpointSettings{
			"frontend": {NetworkID: "frontend-id"},
			"backend":  {NetworkID: "backend-id"},
		},
	}

	newID, err := dc.RecreateContainer(context.Background(), snapshot, "myapp:latest")
	require.NoError(t, err)
	assert.Equal(t, "new-container-id", newID)

	// With 2 networks, one goes in ContainerCreate, one via NetworkConnect
	networkConnectCalls := 0
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "NetworkConnect:") {
			networkConnectCalls++
		}
	}
	assert.Equal(t, 1, networkConnectCalls, "should call NetworkConnect for the second network")
}

// Finding 2.1 — RecreateContainer fails and cleans up on NetworkConnect error
func TestRecreateContainer_NetworkConnectFailure(t *testing.T) {
	mock := &mockDockerAPI{
		networkConnectErr: fmt.Errorf("network unreachable"),
		imageInspect: image.InspectResponse{
			RepoDigests: []string{"myapp@sha256:test"},
		},
	}
	dc := NewDockerClientWithAPI(mock)

	snapshot := &ContainerSnapshot{
		Name:     "myapp",
		ImageRef: "myapp:latest",
		Config:   &container.Config{Image: "myapp:latest"},
		HostConfig: &container.HostConfig{
			NetworkMode:   "bridge",
			RestartPolicy: container.RestartPolicy{Name: "always"},
		},
		Networks: map[string]*network.EndpointSettings{
			"frontend": {NetworkID: "frontend-id"},
			"backend":  {NetworkID: "backend-id"},
		},
	}

	_, err := dc.RecreateContainer(context.Background(), snapshot, "myapp:latest")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to connect network")

	// Verify cleanup: partial container should be stopped and removed
	stopFound := false
	removeFound := false
	for _, call := range mock.getCalls() {
		if strings.HasPrefix(call, "ContainerStop:") {
			stopFound = true
		}
		if strings.HasPrefix(call, "ContainerRemove:") {
			removeFound = true
		}
	}
	assert.True(t, stopFound, "should stop the partially-configured container")
	assert.True(t, removeFound, "should remove the partially-configured container")
}

func TestExtractContainerIDFromCgroup(t *testing.T) {
	const fullID = "abc123def456789abcdef0123456789abc123def456789abcdef0123456789ab"

	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "cgroup v1 docker format",
			content: "12:memory:/docker/" + fullID + "\n",
			want:    fullID,
		},
		{
			name:    "cgroup v2 systemd scope format",
			content: "0::/system.slice/docker-" + fullID + ".scope\n",
			want:    fullID,
		},
		{
			name:    "multiple lines cgroup v1",
			content: "11:blkio:/\n12:memory:/docker/" + fullID + "\n0::/\n",
			want:    fullID,
		},
		{
			name:    "not in a container (bare host)",
			content: "12:memory:/\n0::/\n",
			want:    "",
		},
		{
			name:    "empty content",
			content: "",
			want:    "",
		},
		{
			name:    "short id — not 64 chars",
			content: "12:memory:/docker/abc123\n",
			want:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractContainerIDFromCgroup(tt.content)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsAutoGeneratedHostname(t *testing.T) {
	assert.True(t, isAutoGeneratedHostname("abc123def456"))
	assert.False(t, isAutoGeneratedHostname("watchwarden-agent"))
	assert.False(t, isAutoGeneratedHostname("abc123def45"))  // 11 chars
	assert.False(t, isAutoGeneratedHostname("ABC123DEF456")) // uppercase
}
