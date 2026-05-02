package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	dockertypes "github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/registry"
	"github.com/docker/docker/client"
)

// getSelfContainerID returns the full Docker container ID of the agent process,
// or empty string if not running in a container.
//
// Tries four methods in order:
//  1. /proc/self/cgroup — works with cgroupv1 and cgroupv2 without private namespace.
//  2. /proc/1/cpuset — an alternative cgroupv1 path that some kernels expose.
//  3. HOSTNAME env var — Docker sets this to the 12-char short container ID by
//     default; also works when the user has set an explicit hostname.
//  4. os.Hostname() syscall — same value as HOSTNAME but bypasses env var.
//
// Note: cgroupv2 with --cgroupns=private (Docker 20.10+ default) makes the
// cgroup paths appear as "0::/" inside the container. In that case methods 1
// and 2 return "" and the fallbacks are used.
func getSelfContainerID(ctx context.Context, cli DockerAPI) string {
	containerID := func(info container.InspectResponse) string {
		if info.ContainerJSONBase == nil {
			return ""
		}
		return info.ID
	}

	// Method 1: /proc/self/cgroup (cgroupv1 and cgroupv2 without private NS)
	if data, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		if id := extractContainerIDFromCgroup(string(data)); id != "" {
			if info, err := cli.ContainerInspect(ctx, id); err == nil {
				if id := containerID(info); id != "" {
					return id
				}
			}
		}
	}

	// Method 2: /proc/1/cpuset — alternative cgroupv1 path, format "/docker/<64hex>"
	if data, err := os.ReadFile("/proc/1/cpuset"); err == nil {
		for _, seg := range strings.Split(strings.TrimSpace(string(data)), "/") {
			if len(seg) == 64 && isLowercaseHex(seg) {
				if info, err := cli.ContainerInspect(ctx, seg); err == nil {
					if id := containerID(info); id != "" {
						return id
					}
				}
			}
		}
	}

	// Method 3: HOSTNAME env var — Docker sets this to the short container ID
	// (12 hex chars) unless an explicit hostname is configured. Also handles
	// explicit hostnames (e.g. service name in Compose).
	if hostname := os.Getenv("HOSTNAME"); hostname != "" {
		if info, err := cli.ContainerInspect(ctx, hostname); err == nil {
			if id := containerID(info); id != "" {
				return id
			}
		}
	}

	// Method 4: os.Hostname() syscall — identical to HOSTNAME in containers but
	// works even if the env var was stripped.
	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		if info, err := cli.ContainerInspect(ctx, hostname); err == nil {
			if id := containerID(info); id != "" {
				return id
			}
		}
	}

	return ""
}

// extractContainerIDFromCgroup scans cgroup entries for a 64-char hex container
// ID. Handles both cgroup v1 ("12:memory:/docker/<id>") and cgroup v2
// ("0::/system.slice/docker-<id>.scope").
func extractContainerIDFromCgroup(content string) string {
	for _, line := range strings.Split(content, "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		for _, seg := range strings.Split(parts[2], "/") {
			seg = strings.TrimSuffix(seg, ".scope")
			if strings.HasPrefix(seg, "docker-") {
				seg = seg[len("docker-"):]
			}
			if len(seg) == 64 && isLowercaseHex(seg) {
				return seg
			}
		}
	}
	return ""
}

// isLowercaseHex returns true if s consists entirely of lowercase hex chars.
func isLowercaseHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// FIX-1.4: contextReader wraps an io.Reader so that Read calls return
// immediately with ctx.Err() when the context is cancelled, preventing
// json.Decoder from blocking indefinitely on a hung Docker pull stream.
type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (cr *contextReader) Read(p []byte) (int, error) {
	if err := cr.ctx.Err(); err != nil {
		return 0, err
	}
	return cr.r.Read(p)
}

// DockerClient wraps the Docker SDK client and implements DockerAPI.
type DockerClient struct {
	cli             DockerAPI
	credStore       *CredStore
	labelEnableOnly bool
}

// NewDockerClient creates a DockerClient using the environment Docker config.
func NewDockerClient(labelEnableOnly bool) (*DockerClient, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}
	return &DockerClient{cli: cli, labelEnableOnly: labelEnableOnly}, nil
}

// NewDockerClientWithAPI creates a DockerClient with a provided API (for testing).
func NewDockerClientWithAPI(api DockerAPI) *DockerClient {
	return &DockerClient{cli: api}
}

// semverish matches tags containing at least major.minor version (e.g. "16.2", "1.25.3-alpine", "20.11")
var semverish = regexp.MustCompile(`\d+\.\d+`)

// isPinnedVersion returns true if the image tag is a specific version (not "latest", not empty,
// and not a floating alias like "alpine", "lts", "slim", "jammy", "22-slim").
// A tag is considered pinned only if it contains a major.minor version pattern (e.g. "16.2").
// Tags like "22-slim" with only a major version are floating (they track the latest minor).
// isPinnedVersionWithLabels checks if an image is pinned, but first consults
// the Docker Compose label to see if the original compose image uses a floating
// tag. After a rollback to e.g. :0.16.0, Config.Image changes but the compose
// file still says :latest — that's not pinned.
func isPinnedVersionWithLabels(image string, labels map[string]string) bool {
	if composeImage, ok := labels["com.docker.compose.image"]; ok && composeImage != "" {
		return isPinnedVersion(composeImage)
	}
	// Also check the watchwarden pinned label override
	if val, ok := labels["com.watchwarden.pinned"]; ok {
		return val == "true"
	}
	return isPinnedVersion(image)
}

func isPinnedVersion(image string) bool {
	// No tag or digest → not pinned (uses :latest implicitly)
	if !strings.Contains(image, ":") {
		return false
	}
	// Digest reference → pinned
	if strings.Contains(image, "@sha256:") {
		return true
	}
	// Extract tag
	parts := strings.SplitN(image, ":", 2)
	if len(parts) < 2 {
		return false
	}
	tag := parts[1]
	if tag == "" || tag == "latest" {
		return false
	}
	// Pinned only if tag contains a semver-ish pattern (major.minor)
	return semverish.MatchString(tag)
}

// statefulImages lists base image names of known database/stateful services.
// These are excluded from bulk "Update All" and auto-update to prevent data loss.
var statefulImages = []string{
	"postgres", "postgresql", "mysql", "mariadb", "mongo", "mongodb",
	"redis", "valkey", "memcached", "elasticsearch", "opensearch",
	"meilisearch", "influxdb", "clickhouse", "cockroach",
	"timescaledb", "cassandra", "neo4j", "couchdb", "couchbase",
	"mssql", "oracle", "etcd", "consul", "vault", "zookeeper",
	"kafka", "rabbitmq", "nats", "minio", "rqlite", "surrealdb",
	"arangodb", "dgraph", "foundationdb", "vitess",
}

// isStatefulImage detects if a container image is a known database/stateful service.
func isStatefulImage(imageName string) bool {
	base := imageName
	if atIdx := strings.Index(base, "@"); atIdx > 0 {
		base = base[:atIdx]
	}
	if colonIdx := strings.LastIndex(base, ":"); colonIdx > 0 {
		base = base[:colonIdx]
	}
	if slashIdx := strings.LastIndex(base, "/"); slashIdx >= 0 {
		base = base[slashIdx+1:]
	}
	base = strings.ToLower(base)
	for _, s := range statefulImages {
		if base == s || strings.HasPrefix(base, s+"-") {
			return true
		}
	}
	return false
}

// friendlyImageName returns a short, readable image name.
// "nginx@sha256:abc123..." → "nginx"
// "sha256:abc123..." → containerName
// "nginx:latest" → "nginx:latest" (already friendly)
func friendlyImageName(raw string, containerName string) string {
	// Already friendly (e.g. "nginx:latest", "watchwarden-ui")
	if !strings.Contains(raw, "sha256:") && len(raw) < 60 {
		return raw
	}
	// "nginx@sha256:..." → extract base name "nginx"
	if idx := strings.Index(raw, "@sha256:"); idx > 0 {
		return raw[:idx]
	}
	// Pure hash — use container name
	if strings.HasPrefix(raw, "sha256:") || len(raw) >= 60 {
		return containerName
	}
	return raw
}

// ListContainers returns info for all containers (running and stopped).
func (d *DockerClient) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	containers, err := d.cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	result := make([]ContainerInfo, 0, len(containers))
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		digest := ""
		imageName := c.Image
		if len(c.Image) > 0 {
			imgInspect, _, err := d.cli.ImageInspectWithRaw(ctx, c.Image)
			if err == nil {
				if len(imgInspect.RepoDigests) > 0 {
					digest = imgInspect.RepoDigests[0]
				}
				if len(imgInspect.RepoTags) > 0 {
					imageName = imgInspect.RepoTags[0]
				}
			}
		}
		// If image is still not friendly, try to extract base name
		imageName = friendlyImageName(imageName, name)

		excluded := false
		excludeReason := ""

		if val, ok := c.Labels["com.watchwarden.enable"]; ok && val == "false" {
			excluded = true
			excludeReason = "label:com.watchwarden.enable=false"
		}

		if d.labelEnableOnly {
			val, hasLabel := c.Labels["com.watchwarden.enable"]
			if !hasLabel || val != "true" {
				excluded = true
				excludeReason = "opt-in mode: missing label com.watchwarden.enable=true"
			}
		}

		// Extract update group labels
		group := c.Labels["com.watchwarden.group"]
		priority := 100
		if p, ok := c.Labels["com.watchwarden.priority"]; ok {
			if v, err := strconv.Atoi(p); err == nil {
				priority = v
			}
		}
		var dependsOn []string
		if deps, ok := c.Labels["com.watchwarden.depends_on"]; ok && deps != "" {
			for _, d := range strings.Split(deps, ",") {
				d = strings.TrimSpace(d)
				if d != "" {
					dependsOn = append(dependsOn, d)
				}
			}
		}

		policy := c.Labels["com.watchwarden.policy"]
		tagPattern := c.Labels["com.watchwarden.tag_pattern"]
		updateLevel := c.Labels["com.watchwarden.update_level"]

		// Extract health status from Docker's status string (e.g. "Up 2h (healthy)")
		healthStatus := "none"
		statusStr := c.Status
		if strings.Contains(statusStr, "(healthy)") {
			healthStatus = "healthy"
		} else if strings.Contains(statusStr, "(unhealthy)") {
			healthStatus = "unhealthy"
		} else if strings.Contains(statusStr, "(health: starting)") {
			healthStatus = "starting"
		}

		// Detect stateful containers (databases, caches) — label override takes priority
		isStateful := isStatefulImage(imageName)
		if val, ok := c.Labels["com.watchwarden.stateful"]; ok {
			isStateful = val == "true"
		}

		result = append(result, ContainerInfo{
			ID:            c.ID[:12],
			DockerID:      c.ID,
			Name:          name,
			Image:         imageName,
			CurrentDigest: digest,
			Status:        c.State,
			HealthStatus:  healthStatus,
			Excluded:      excluded,
			ExcludeReason: excludeReason,
			PinnedVersion: isPinnedVersionWithLabels(imageName, c.Labels),
			Group:         group,
			Priority:      priority,
			DependsOn:     dependsOn,
			Policy:        policy,
			TagPattern:    tagPattern,
			UpdateLevel:   updateLevel,
			IsStateful:    isStateful,
		})
	}
	return result, nil
}

// ResolveContainerID finds the current container ID, trying the given ID first,
// then falling back to searching by name. This handles stale IDs after container recreation.
func (d *DockerClient) ResolveContainerID(ctx context.Context, containerIDOrName string) (string, error) {
	// Try direct inspect first
	info, err := d.cli.ContainerInspect(ctx, containerIDOrName)
	if err == nil {
		return info.ID, nil
	}

	// DS-04: use All:true so stopped containers are included in the fallback search.
	// Previously All:false meant CONTAINER_START on a stopped container would fail
	// with "container not found" even though it existed.
	containers, listErr := d.cli.ContainerList(ctx, container.ListOptions{All: true})
	if listErr != nil {
		return "", fmt.Errorf("failed to resolve container %s: %w", containerIDOrName, err)
	}

	for _, c := range containers {
		for _, name := range c.Names {
			cleanName := strings.TrimPrefix(name, "/")
			if cleanName == containerIDOrName || c.ID == containerIDOrName || strings.HasPrefix(c.ID, containerIDOrName) {
				return c.ID, nil
			}
		}
	}

	return "", fmt.Errorf("container not found: %s", containerIDOrName)
}

// InspectContainer returns a full snapshot of a container's configuration.
func (d *DockerClient) InspectContainer(ctx context.Context, containerID string) (*ContainerSnapshot, error) {
	info, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container %s: %w", containerID, err)
	}

	// Build network config
	networks := make(map[string]*network.EndpointSettings)
	if info.NetworkSettings != nil {
		for name, ep := range info.NetworkSettings.Networks {
			networks[name] = ep
		}
	}

	// Get image digest
	digest := ""
	imgInspect, _, err := d.cli.ImageInspectWithRaw(ctx, info.Image)
	if err == nil && len(imgInspect.RepoDigests) > 0 {
		digest = imgInspect.RepoDigests[0]
	}

	return &ContainerSnapshot{
		Name:        strings.TrimPrefix(info.Name, "/"),
		ImageRef:    info.Config.Image,
		ImageDigest: digest,
		Config:      info.Config,
		HostConfig:  info.HostConfig,
		Networks:    networks,
	}, nil
}

// PullImage pulls an image and returns the new digest.
func (d *DockerClient) PullImage(ctx context.Context, ref string) (string, error) {
	pullOpts := image.PullOptions{}
	if d.credStore != nil {
		if cred := d.credStore.GetForImage(ref); cred != nil {
			authConfig := registry.AuthConfig{
				Username:      cred.Username,
				Password:      cred.Password,
				ServerAddress: cred.Registry,
			}
			encoded, err := json.Marshal(authConfig)
			if err != nil {
				log.Printf("[docker] failed to marshal auth config: %v", err)
			} else {
				pullOpts.RegistryAuth = base64.URLEncoding.EncodeToString(encoded)
			}
		}
	}
	reader, err := d.cli.ImagePull(ctx, ref, pullOpts)
	if err != nil {
		return "", fmt.Errorf("failed to pull image %s: %w", ref, err)
	}
	defer reader.Close()

	// FIX-1.4: wrap the reader in a context-aware reader so json.Decoder.Decode()
	// unblocks promptly when the context is cancelled, instead of waiting for the
	// Docker daemon to send more data (which may never come on a hung pull).
	// DS-01: also check ctx.Err() after each failed Decode as a safety net.
	ctxReader := &contextReader{ctx: ctx, r: reader}
	decoder := json.NewDecoder(ctxReader)
	var digest string
	for {
		var event map[string]interface{}
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				break
			}
			// If the context was cancelled the underlying reader will have returned
			// a non-EOF error — propagate it so callers abort immediately — DS-01.
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			// Transient decode error on a single event; keep reading the stream.
			continue
		}
		if status, ok := event["status"].(string); ok {
			if strings.HasPrefix(status, "Digest: ") {
				digest = strings.TrimPrefix(status, "Digest: ")
			}
			// Log pull progress for diagnostics
			if id, hasID := event["id"].(string); hasID {
				log.Printf("[pull] %s: %s %s", ref, id, status)
			} else if status != "" {
				log.Printf("[pull] %s: %s", ref, status)
			}
		}
	}

	// Always inspect the image after pull to get the authoritative digest.
	// The pull stream's "Digest:" line may report the manifest list digest
	// (multi-arch index) while the container uses the platform-specific digest.
	// Inspecting gives us the actual digest Docker resolved for this platform.
	imgInspect, _, err := d.cli.ImageInspectWithRaw(ctx, ref)
	if err == nil && len(imgInspect.RepoDigests) > 0 {
		// Use the repo digest that matches the registry (most specific)
		for _, rd := range imgInspect.RepoDigests {
			if strings.Contains(rd, "sha256:") {
				digest = rd
				break
			}
		}
		if digest == "" {
			digest = imgInspect.RepoDigests[0]
		}
	}

	return digest, nil
}

// GetRemoteDigest queries the registry for the current manifest digest without
// downloading any image layers. This is used during CHECK to compare digests
// cheaply — PullImage is reserved for the actual UPDATE path.
func (d *DockerClient) GetRemoteDigest(ctx context.Context, ref string) (string, error) {
	var encodedAuth string
	if d.credStore != nil {
		if cred := d.credStore.GetForImage(ref); cred != nil {
			authConfig := registry.AuthConfig{
				Username:      cred.Username,
				Password:      cred.Password,
				ServerAddress: cred.Registry,
			}
			encoded, err := json.Marshal(authConfig)
			if err == nil {
				encodedAuth = base64.URLEncoding.EncodeToString(encoded)
			}
		}
	}
	info, err := d.cli.DistributionInspect(ctx, ref, encodedAuth)
	if err != nil {
		return "", fmt.Errorf("registry inspect %s: %w", ref, err)
	}
	return string(info.Descriptor.Digest), nil
}

// isSpecialNetworkMode returns true for network modes that are managed by HostConfig
// and should not have a separate networkingConfig passed to ContainerCreate.
func isSpecialNetworkMode(mode string) bool {
	return mode == "host" || mode == "none" || strings.HasPrefix(mode, "container:")
}

// isAutoGeneratedHostname returns true if the hostname looks like Docker's
// auto-generated short container ID (exactly 12 lowercase hex chars).
// Docker sets HOSTNAME to this value when no explicit hostname is configured.
// Preserving it across container recreation causes getSelfContainerID to fail
// on the new container because the old container ID no longer exists.
func isAutoGeneratedHostname(h string) bool {
	return len(h) == 12 && isLowercaseHex(h)
}

// recreateContainerWithName is the internal implementation for container recreation.
func (d *DockerClient) recreateContainerWithName(ctx context.Context, snapshot *ContainerSnapshot, newImage string, name string) (string, error) {
	// Update config with new image
	newConfig := *snapshot.Config
	newConfig.Image = newImage

	// Clear auto-generated hostname so the new container gets one from its own ID.
	// Docker sets Hostname to the short container ID (12 hex chars) when none is
	// configured; copying it to the new container breaks getSelfContainerID because
	// the old container ID no longer exists after recreation.
	if isAutoGeneratedHostname(newConfig.Hostname) {
		newConfig.Hostname = ""
	}

	// Docker rejects hostname, exposed ports, and port bindings when using
	// container:/host/none network mode — the container inherits networking
	// from the target, so these settings conflict.
	if snapshot.HostConfig != nil && isSpecialNetworkMode(string(snapshot.HostConfig.NetworkMode)) {
		newConfig.Hostname = ""
		newConfig.Domainname = ""
		newConfig.ExposedPorts = nil
		snapshot.HostConfig.PortBindings = nil
	}

	// Determine if network mode is special (handled by HostConfig only)
	var networkingConfig *network.NetworkingConfig
	if snapshot.HostConfig == nil || !isSpecialNetworkMode(string(snapshot.HostConfig.NetworkMode)) {
		// Build networking config for the first network
		for netName, ep := range snapshot.Networks {
			networkingConfig = &network.NetworkingConfig{
				EndpointsConfig: map[string]*network.EndpointSettings{
					netName: ep,
				},
			}
			break // Only first network in create
		}
	}

	// Create new container
	resp, err := d.cli.ContainerCreate(ctx, &newConfig, snapshot.HostConfig, networkingConfig, nil, name)
	if err != nil {
		return "", fmt.Errorf("failed to create container: %w", err)
	}

	// Connect additional networks (only for non-special network modes)
	// FIX-2.1: NetworkConnect failures now fail the update and clean up the
	// partially-connected container, instead of silently leaving it running
	// with missing networks that could cause connectivity issues.
	if snapshot.HostConfig == nil || !isSpecialNetworkMode(string(snapshot.HostConfig.NetworkMode)) {
		first := true
		for netName, ep := range snapshot.Networks {
			if first {
				first = false
				continue // Skip first, already in create
			}
			if err := d.cli.NetworkConnect(ctx, netName, resp.ID, ep); err != nil {
				log.Printf("error: failed to connect network %s to container %s: %v", netName, resp.ID, err)
				// Clean up the partially-configured container
				timeout := 10
				_ = d.cli.ContainerStop(ctx, resp.ID, container.StopOptions{Timeout: &timeout})
				_ = d.cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{})
				return "", fmt.Errorf("failed to connect network %s: %w", netName, err)
			}
		}
	}

	// Start the container
	if err := d.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		// Clean up the created-but-not-started container so the name is freed.
		_ = d.cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return "", fmt.Errorf("failed to start container: %w", err)
	}

	return resp.ID, nil
}

// RecreateContainer stops, removes, and recreates a container with a new image.
func (d *DockerClient) RecreateContainer(ctx context.Context, snapshot *ContainerSnapshot, newImage string) (string, error) {
	return d.recreateContainerWithName(ctx, snapshot, newImage, snapshot.Name)
}

// RecreateContainerNamed recreates a container with a new image and a custom name.
func (d *DockerClient) RecreateContainerNamed(ctx context.Context, snapshot *ContainerSnapshot, newImage string, name string) (string, error) {
	return d.recreateContainerWithName(ctx, snapshot, newImage, name)
}

// ContainerRename renames a container.
func (d *DockerClient) ContainerRename(ctx context.Context, containerID, newName string) error {
	type renamer interface {
		ContainerRename(ctx context.Context, containerID, newName string) error
	}
	r, ok := d.cli.(renamer)
	if !ok {
		return fmt.Errorf("underlying client does not support ContainerRename")
	}
	return r.ContainerRename(ctx, containerID, newName)
}

// GetDockerVersion returns Docker server version info by duck-typing the underlying client.
// Returns nil if the client does not support ServerVersion (e.g. in tests).
func (d *DockerClient) GetDockerVersion(ctx context.Context) *DockerVersionInfo {
	type serverVersioner interface {
		ServerVersion(context.Context) (dockertypes.Version, error)
	}
	sv, ok := d.cli.(serverVersioner)
	if !ok {
		return nil
	}
	v, err := sv.ServerVersion(ctx)
	if err != nil {
		return nil
	}
	return &DockerVersionInfo{
		ServerVersion: v.Version,
		APIVersion:    v.APIVersion,
		OS:            v.Os,
		Arch:          v.Arch,
	}
}

// GetContainerLogs returns the last `tail` lines of a container's stdout/stderr.
func (d *DockerClient) GetContainerLogs(ctx context.Context, containerID string, tail int) (string, error) {
	// Check if container uses TTY (affects stream format)
	info, err := d.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return "", fmt.Errorf("inspect failed: %w", err)
	}

	reader, err := d.cli.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       strconv.Itoa(tail),
	})
	if err != nil {
		return "", fmt.Errorf("failed to get logs: %w", err)
	}
	defer reader.Close()

	// Cap read at 900KB to stay within WS message limits
	limited := io.LimitReader(reader, 900*1024)

	if info.Config != nil && info.Config.Tty {
		// TTY mode: stream is raw text, no multiplexing
		data, err := io.ReadAll(limited)
		if err != nil {
			return "", fmt.Errorf("read logs failed: %w", err)
		}
		return string(data), nil
	}

	// Non-TTY: Docker multiplexed stream with 8-byte headers per frame.
	// Strip headers manually: [stream_type(1)][0 0 0][size(4 big-endian)][payload]
	var buf bytes.Buffer
	header := make([]byte, 8)
	for {
		_, err := io.ReadFull(limited, header)
		if err != nil {
			break // EOF or limit reached
		}
		size := int(header[4])<<24 | int(header[5])<<16 | int(header[6])<<8 | int(header[7])
		if size <= 0 || size > 900*1024 {
			break
		}
		_, err = io.CopyN(&buf, limited, int64(size))
		if err != nil {
			break
		}
	}
	return buf.String(), nil
}

// startContainerWithNetworkAwareness starts a container, handling the case
// where its HostConfig.NetworkMode references a stale network container ID.
// Docker Compose bakes the network provider's container ID at creation time;
// if that provider was recreated (new ID), ContainerStart fails with
// "No such container: <stale-id>". This function detects the stale ref,
// finds the current provider via compose labels, recreates the target
// container pointing to the new ID, and starts it.
func startContainerWithNetworkAwareness(
	ctx context.Context,
	cli DockerAPI,
	resolvedID, logID string,
	pullImage func(ctx context.Context, imageRef string) error,
) error {
	info, err := cli.ContainerInspect(ctx, resolvedID)
	if err != nil || info.HostConfig == nil {
		return cli.ContainerStart(ctx, resolvedID, container.StartOptions{})
	}
	nm := string(info.HostConfig.NetworkMode)
	if !strings.HasPrefix(nm, "container:") {
		return cli.ContainerStart(ctx, resolvedID, container.StartOptions{})
	}
	netContainerRef := strings.TrimPrefix(nm, "container:")
	netInfo, netInspectErr := cli.ContainerInspect(ctx, netContainerRef)
	if netInspectErr != nil {
		// Stale ref — find the replacement network provider via compose labels.
		log.Printf("[container] Network container %s is stale for %s; searching replacement", netContainerRef, logID)
		newNetID, findErr := findNetworkProviderByLabels(ctx, cli, info.Config.Labels)
		if findErr != nil {
			return fmt.Errorf("stale network container %s, could not find replacement: %w", netContainerRef, findErr)
		}
		log.Printf("[container] Recreating %s with network container %s", logID, newNetID)
		return recreateWithNetworkContainer(ctx, cli, resolvedID, info, newNetID, pullImage)
	}
	if netInfo.State == nil || !netInfo.State.Running {
		log.Printf("[container] Starting network container %s before %s", netContainerRef, logID)
		_ = cli.ContainerStart(ctx, netContainerRef, container.StartOptions{})
		waitForContainerRunningOrHealthy(ctx, cli, netContainerRef, 60)
	}
	return cli.ContainerStart(ctx, resolvedID, container.StartOptions{})
}

// findNetworkProviderByLabels locates the currently running container that
// provides the network namespace for a container in the same Docker Compose
// project. It parses the com.docker.compose.depends_on label (format:
// "svc:condition:required,...") to get candidate service names, then finds a
// running container in the same project with one of those service names.
func findNetworkProviderByLabels(ctx context.Context, cli DockerAPI, labels map[string]string) (string, error) {
	project := labels["com.docker.compose.project"]
	if project == "" {
		return "", fmt.Errorf("container has no com.docker.compose.project label")
	}
	dependsOnRaw := labels["com.docker.compose.depends_on"]
	if dependsOnRaw == "" {
		return "", fmt.Errorf("container has no com.docker.compose.depends_on label")
	}
	// Parse "svc1:condition:required,svc2:condition:required" → ["svc1", "svc2"]
	var depServices []string
	for _, part := range strings.Split(dependsOnRaw, ",") {
		svc := strings.SplitN(strings.TrimSpace(part), ":", 2)[0]
		if svc != "" {
			depServices = append(depServices, svc)
		}
	}
	if len(depServices) == 0 {
		return "", fmt.Errorf("could not parse service names from depends_on label: %q", dependsOnRaw)
	}
	running, err := cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("list containers: %w", err)
	}
	for _, c := range running {
		if c.Labels["com.docker.compose.project"] != project {
			continue
		}
		svc := c.Labels["com.docker.compose.service"]
		for _, dep := range depServices {
			if svc == dep {
				return c.ID, nil
			}
		}
	}
	return "", fmt.Errorf("no running container found for services %v in project %q", depServices, project)
}

// recreateWithNetworkContainer removes a stopped container and recreates it
// with an updated NetworkMode pointing to newNetContainerID, then starts it.
// This is required when the original network provider (e.g. gluetun) was
// recreated and the baked-in container ID in HostConfig.NetworkMode is stale.
func recreateWithNetworkContainer(
	ctx context.Context,
	cli DockerAPI,
	oldID string,
	info container.InspectResponse,
	newNetContainerID string,
	pullImage func(ctx context.Context, imageRef string) error,
) error {
	name := strings.TrimPrefix(info.Name, "/")
	info.HostConfig.NetworkMode = container.NetworkMode("container:" + newNetContainerID)
	// Docker rejects container-network mode when a hostname or domainname is set
	// in the container config ("conflicting options: hostname and the network mode").
	info.Config.Hostname = ""
	info.Config.Domainname = ""
	if err := cli.ContainerRemove(ctx, oldID, container.RemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("remove old container: %w", err)
	}
	resp, err := cli.ContainerCreate(ctx, info.Config, info.HostConfig, &network.NetworkingConfig{}, nil, name)
	if err != nil && pullImage != nil {
		// Image may have been pruned locally — pull and retry once.
		log.Printf("[container] ContainerCreate failed (%v); pulling %s and retrying", err, info.Config.Image)
		if pullErr := pullImage(ctx, info.Config.Image); pullErr != nil {
			log.Printf("[container] Pull %s failed: %v", info.Config.Image, pullErr)
		} else {
			resp, err = cli.ContainerCreate(ctx, info.Config, info.HostConfig, &network.NetworkingConfig{}, nil, name)
		}
	}
	if err != nil {
		return fmt.Errorf("create container: %w", err)
	}
	return cli.ContainerStart(ctx, resp.ID, container.StartOptions{})
}

// waitForContainerRunningOrHealthy polls until the container is running (and
// healthy if it has a healthcheck), or until the timeout elapses. Returns true
// if the container is ready within the deadline.
func waitForContainerRunningOrHealthy(ctx context.Context, cli DockerAPI, containerID string, timeoutSecs int) bool {
	deadline := time.Now().Add(time.Duration(timeoutSecs) * time.Second)
	for time.Now().Before(deadline) {
		info, err := cli.ContainerInspect(ctx, containerID)
		if err == nil && info.ContainerJSONBase != nil && info.State != nil && info.State.Running {
			if info.State.Health == nil {
				return true // no healthcheck — running is enough
			}
			if info.State.Health.Status == "healthy" {
				return true
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(5 * time.Second):
		}
	}
	return false
}
