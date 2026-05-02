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

// --- startContainerWithNetworkAwareness tests ---

// TestStartContainerWithNetworkAwareness_BridgeMode verifies that a container
// with no container: network mode calls ContainerStart once directly.
func TestStartContainerWithNetworkAwareness_BridgeMode(t *testing.T) {
	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			return container.InspectResponse{
				ContainerJSONBase: &container.ContainerJSONBase{
					Name:       "/" + id,
					HostConfig: &container.HostConfig{NetworkMode: "bridge"},
					State:      &container.State{Running: false},
				},
				Config: &container.Config{Labels: map[string]string{}},
			}, nil
		},
	}

	err := startContainerWithNetworkAwareness(context.Background(), mock, "mycontainer", "mycontainer", nil)
	require.NoError(t, err)

	calls := mock.getCalls()
	startCalls := 0
	for _, c := range calls {
		if strings.HasPrefix(c, "ContainerStart:") {
			startCalls++
		}
	}
	assert.Equal(t, 1, startCalls, "should call ContainerStart exactly once for bridge network mode")
	assert.Contains(t, calls, "ContainerStart:mycontainer")
}

// TestStartContainerWithNetworkAwareness_NetworkContainerRunning verifies that
// when the referenced network container exists and is running, ContainerStart
// is called directly for the target (no pre-start of the network container).
func TestStartContainerWithNetworkAwareness_NetworkContainerRunning(t *testing.T) {
	const targetID = "target-container"
	const netID = "net-provider-id"

	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			switch id {
			case targetID:
				return container.InspectResponse{
					ContainerJSONBase: &container.ContainerJSONBase{
						Name:       "/" + id,
						HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode("container:" + netID)},
						State:      &container.State{Running: false},
					},
					Config: &container.Config{Labels: map[string]string{}},
				}, nil
			case netID:
				return container.InspectResponse{
					ContainerJSONBase: &container.ContainerJSONBase{
						Name:  "/" + id,
						State: &container.State{Running: true},
					},
				}, nil
			default:
				return container.InspectResponse{}, fmt.Errorf("no such container: %s", id)
			}
		},
	}

	err := startContainerWithNetworkAwareness(context.Background(), mock, targetID, targetID, nil)
	require.NoError(t, err)

	calls := mock.getCalls()
	// Only the target should be started; net container is already running
	startCalls := []string{}
	for _, c := range calls {
		if strings.HasPrefix(c, "ContainerStart:") {
			startCalls = append(startCalls, c)
		}
	}
	assert.Equal(t, 1, len(startCalls), "should start only the target container")
	assert.Equal(t, "ContainerStart:"+targetID, startCalls[0])
}

// TestStartContainerWithNetworkAwareness_NetworkContainerStopped verifies that
// when the referenced network container exists but is stopped, it is started
// first and then the target container is started.
// The inspectFn transitions the net container from stopped → running after
// ContainerStart has been recorded for it, so waitForContainerRunningOrHealthy
// returns promptly instead of waiting the full 60-second timeout.
func TestStartContainerWithNetworkAwareness_NetworkContainerStopped(t *testing.T) {
	const targetID = "target-container"
	const netID = "net-provider-id"

	mock := &mockDockerAPI{}
	mock.inspectFn = func(id string) (container.InspectResponse, error) {
		switch id {
		case targetID:
			return container.InspectResponse{
				ContainerJSONBase: &container.ContainerJSONBase{
					Name:       "/" + id,
					HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode("container:" + netID)},
					State:      &container.State{Running: false},
				},
				Config: &container.Config{Labels: map[string]string{}},
			}, nil
		case netID:
			// Report running only after ContainerStart:netID has been recorded,
			// so waitForContainerRunningOrHealthy returns on the first poll.
			running := false
			for _, c := range mock.getCalls() {
				if c == "ContainerStart:"+netID {
					running = true
					break
				}
			}
			return container.InspectResponse{
				ContainerJSONBase: &container.ContainerJSONBase{
					Name:  "/" + id,
					State: &container.State{Running: running},
				},
			}, nil
		default:
			return container.InspectResponse{}, fmt.Errorf("no such container: %s", id)
		}
	}

	err := startContainerWithNetworkAwareness(context.Background(), mock, targetID, targetID, nil)
	require.NoError(t, err)

	calls := mock.getCalls()
	startCalls := []string{}
	for _, c := range calls {
		if strings.HasPrefix(c, "ContainerStart:") {
			startCalls = append(startCalls, c)
		}
	}
	require.GreaterOrEqual(t, len(startCalls), 2, "should start net container then target; calls: %v", calls)
	assert.Equal(t, "ContainerStart:"+netID, startCalls[0], "net container should be started first")
	assert.Equal(t, "ContainerStart:"+targetID, startCalls[len(startCalls)-1], "target should be started last")
}

// TestStartContainerWithNetworkAwareness_StaleNetIDWithComposeLabels verifies
// that when the network container ID is stale (inspect returns error) and the
// target has compose project/depends_on labels, the function finds the
// replacement and recreates the container (ContainerRemove + ContainerCreate +
// ContainerStart observed).
func TestStartContainerWithNetworkAwareness_StaleNetIDWithComposeLabels(t *testing.T) {
	const targetID = "target-container"
	const staleNetID = "stale-net-id"
	const newNetID = "new-net-id"

	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			switch id {
			case targetID:
				return container.InspectResponse{
					ContainerJSONBase: &container.ContainerJSONBase{
						Name:       "/myapp",
						HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode("container:" + staleNetID)},
						State:      &container.State{Running: false},
					},
					Config: &container.Config{Labels: map[string]string{
						"com.docker.compose.project":    "myproject",
						"com.docker.compose.depends_on": "vpn:service_started:true",
					}},
				}, nil
			default:
				// stale net container — not found
				return container.InspectResponse{}, fmt.Errorf("no such container: %s", id)
			}
		},
		containerListFn: func(_ context.Context, _ container.ListOptions) ([]container.Summary, error) {
			return []container.Summary{
				{
					ID:    newNetID,
					Names: []string{"/myproject_vpn_1"},
					State: "running",
					Labels: map[string]string{
						"com.docker.compose.project": "myproject",
						"com.docker.compose.service": "vpn",
					},
				},
			}, nil
		},
	}

	err := startContainerWithNetworkAwareness(context.Background(), mock, targetID, targetID, nil)
	require.NoError(t, err)

	calls := mock.getCalls()
	removeFound := false
	createFound := false
	startFound := false
	for _, c := range calls {
		if strings.HasPrefix(c, "ContainerRemove:"+targetID) {
			removeFound = true
		}
		if strings.HasPrefix(c, "ContainerCreate:") {
			createFound = true
		}
		if strings.HasPrefix(c, "ContainerStart:") {
			startFound = true
		}
	}
	assert.True(t, removeFound, "should remove old container; calls: %v", calls)
	assert.True(t, createFound, "should create new container with updated network; calls: %v", calls)
	assert.True(t, startFound, "should start the recreated container; calls: %v", calls)
}

// TestStartContainerWithNetworkAwareness_StaleNetIDNoComposeLabels verifies
// that when the network container ID is stale and no compose labels are present
// to find a replacement, the function returns an error.
func TestStartContainerWithNetworkAwareness_StaleNetIDNoComposeLabels(t *testing.T) {
	const targetID = "target-container"
	const staleNetID = "stale-net-id"

	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			if id == targetID {
				return container.InspectResponse{
					ContainerJSONBase: &container.ContainerJSONBase{
						Name:       "/myapp",
						HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode("container:" + staleNetID)},
						State:      &container.State{Running: false},
					},
					// No compose labels
					Config: &container.Config{Labels: map[string]string{}},
				}, nil
			}
			return container.InspectResponse{}, fmt.Errorf("no such container: %s", id)
		},
	}

	err := startContainerWithNetworkAwareness(context.Background(), mock, targetID, targetID, nil)
	assert.Error(t, err, "should return error when stale net container and no compose labels")
	assert.Contains(t, err.Error(), staleNetID)
}

// --- findNetworkProviderByLabels tests ---

// TestFindNetworkProviderByLabels_NoProjectLabel verifies an error is returned
// when the com.docker.compose.project label is absent.
func TestFindNetworkProviderByLabels_NoProjectLabel(t *testing.T) {
	mock := &mockDockerAPI{}
	_, err := findNetworkProviderByLabels(context.Background(), mock, map[string]string{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "com.docker.compose.project")
}

// TestFindNetworkProviderByLabels_NoDependsOnLabel verifies an error is
// returned when the com.docker.compose.depends_on label is absent.
func TestFindNetworkProviderByLabels_NoDependsOnLabel(t *testing.T) {
	mock := &mockDockerAPI{}
	labels := map[string]string{
		"com.docker.compose.project": "myproject",
	}
	_, err := findNetworkProviderByLabels(context.Background(), mock, labels)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "com.docker.compose.depends_on")
}

// TestFindNetworkProviderByLabels_MatchingContainerFound verifies that when a
// running container with the correct project and service labels exists, its ID
// is returned.
func TestFindNetworkProviderByLabels_MatchingContainerFound(t *testing.T) {
	const expectedID = "vpn-container-id"
	mock := &mockDockerAPI{
		containerListFn: func(_ context.Context, _ container.ListOptions) ([]container.Summary, error) {
			return []container.Summary{
				{
					ID:    expectedID,
					Names: []string{"/myproject_vpn_1"},
					State: "running",
					Labels: map[string]string{
						"com.docker.compose.project": "myproject",
						"com.docker.compose.service": "vpn",
					},
				},
				{
					ID:    "other-container",
					Names: []string{"/myproject_web_1"},
					State: "running",
					Labels: map[string]string{
						"com.docker.compose.project": "myproject",
						"com.docker.compose.service": "web",
					},
				},
			}, nil
		},
	}

	labels := map[string]string{
		"com.docker.compose.project":    "myproject",
		"com.docker.compose.depends_on": "vpn:service_started:true,db:service_healthy:false",
	}

	id, err := findNetworkProviderByLabels(context.Background(), mock, labels)
	require.NoError(t, err)
	assert.Equal(t, expectedID, id)
}

// TestFindNetworkProviderByLabels_NoMatchingContainer verifies that an error
// is returned when no running container matches the project and service names.
func TestFindNetworkProviderByLabels_NoMatchingContainer(t *testing.T) {
	mock := &mockDockerAPI{
		containerListFn: func(_ context.Context, _ container.ListOptions) ([]container.Summary, error) {
			return []container.Summary{
				{
					ID:    "wrong-project-container",
					Names: []string{"/otherproject_vpn_1"},
					State: "running",
					Labels: map[string]string{
						"com.docker.compose.project": "otherproject",
						"com.docker.compose.service": "vpn",
					},
				},
			}, nil
		},
	}

	labels := map[string]string{
		"com.docker.compose.project":    "myproject",
		"com.docker.compose.depends_on": "vpn:service_started:true",
	}

	_, err := findNetworkProviderByLabels(context.Background(), mock, labels)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no running container found")
}

// --- recreateWithNetworkContainer tests ---

// TestRecreateWithNetworkContainer_HappyPath verifies that the old container is
// removed, a new one is created with the updated NetworkMode pointing to
// newNetContainerID, and the new container is started.
func TestRecreateWithNetworkContainer_HappyPath(t *testing.T) {
	const oldID = "old-container-id"
	const newNetID = "new-net-provider-id"

	mock := &mockDockerAPI{}

	info := container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			Name:       "/myapp",
			HostConfig: &container.HostConfig{NetworkMode: "container:stale-net-id"},
			State:      &container.State{Running: false},
		},
		Config: &container.Config{
			Image:      "myapp:latest",
			Hostname:   "myapp-hostname",
			Domainname: "local",
			Labels:     map[string]string{},
		},
	}

	err := recreateWithNetworkContainer(context.Background(), mock, oldID, info, newNetID, nil)
	require.NoError(t, err)

	// Hostname and Domainname must be cleared — Docker rejects them with container network mode
	assert.Empty(t, info.Config.Hostname, "Hostname must be cleared before ContainerCreate")
	assert.Empty(t, info.Config.Domainname, "Domainname must be cleared before ContainerCreate")

	calls := mock.getCalls()

	// ContainerRemove must be called with the old ID
	removeFound := false
	for _, c := range calls {
		if c == "ContainerRemove:"+oldID {
			removeFound = true
		}
	}
	assert.True(t, removeFound, "ContainerRemove should be called with oldID; calls: %v", calls)

	// ContainerCreate must be called
	createFound := false
	for _, c := range calls {
		if strings.HasPrefix(c, "ContainerCreate:") {
			createFound = true
		}
	}
	assert.True(t, createFound, "ContainerCreate should be called; calls: %v", calls)

	// ContainerStart must be called with the new container ID returned by ContainerCreate
	startFound := false
	for _, c := range calls {
		if c == "ContainerStart:new-container-id" {
			startFound = true
		}
	}
	assert.True(t, startFound, "ContainerStart should be called with new container ID; calls: %v", calls)

	// Verify remove happens before create
	removeIdx, createIdx := -1, -1
	for i, c := range calls {
		if c == "ContainerRemove:"+oldID {
			removeIdx = i
		}
		if strings.HasPrefix(c, "ContainerCreate:") {
			createIdx = i
		}
	}
	assert.Less(t, removeIdx, createIdx, "ContainerRemove must be called before ContainerCreate")
}

// --- waitForContainerRunningOrHealthy tests ---

// TestWaitForContainerRunningOrHealthy_ImmediatelyRunning verifies that when
// the container is already running with no healthcheck, the function returns
// true immediately without waiting.
func TestWaitForContainerRunningOrHealthy_ImmediatelyRunning(t *testing.T) {
	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			return container.InspectResponse{
				ContainerJSONBase: &container.ContainerJSONBase{
					ID:    id,
					Name:  "/" + id,
					State: &container.State{Running: true, Health: nil},
				},
			}, nil
		},
	}

	ctx := context.Background()
	ready := waitForContainerRunningOrHealthy(ctx, mock, "mycontainer", 5)
	assert.True(t, ready, "should return true when container is running with no healthcheck")
}

// TestWaitForContainerRunningOrHealthy_RunningAndHealthy verifies that a
// container that is running with a healthy healthcheck status returns true.
func TestWaitForContainerRunningOrHealthy_RunningAndHealthy(t *testing.T) {
	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			return container.InspectResponse{
				ContainerJSONBase: &container.ContainerJSONBase{
					ID:   id,
					Name: "/" + id,
					State: &container.State{
						Running: true,
						Health:  &container.Health{Status: "healthy"},
					},
				},
			}, nil
		},
	}

	ctx := context.Background()
	ready := waitForContainerRunningOrHealthy(ctx, mock, "mycontainer", 5)
	assert.True(t, ready, "should return true when container is running and healthy")
}

// TestWaitForContainerRunningOrHealthy_TimeoutExpires verifies that when the
// container never reaches a ready state within the timeout, false is returned.
func TestWaitForContainerRunningOrHealthy_TimeoutExpires(t *testing.T) {
	mock := &mockDockerAPI{
		inspectFn: func(id string) (container.InspectResponse, error) {
			// Always return "starting" — never becomes healthy
			return container.InspectResponse{
				ContainerJSONBase: &container.ContainerJSONBase{
					ID:   id,
					Name: "/" + id,
					State: &container.State{
						Running: true,
						Health:  &container.Health{Status: "starting"},
					},
				},
			}, nil
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	start := time.Now()
	ready := waitForContainerRunningOrHealthy(ctx, mock, "mycontainer", 1)
	elapsed := time.Since(start)

	assert.False(t, ready, "should return false when timeout expires before container is ready")
	assert.Less(t, elapsed, 5*time.Second, "should not block longer than the timeout")
}
