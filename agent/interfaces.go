package main

import (
	"context"
	"io"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/registry"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
)

// DockerAPI abstracts Docker operations for testability.
type DockerAPI interface {
	ContainerList(ctx context.Context, options container.ListOptions) ([]container.Summary, error)
	ContainerInspect(ctx context.Context, containerID string) (container.InspectResponse, error)
	ContainerStop(ctx context.Context, containerID string, options container.StopOptions) error
	ContainerRemove(ctx context.Context, containerID string, options container.RemoveOptions) error
	ContainerCreate(ctx context.Context, config *container.Config, hostConfig *container.HostConfig, networkingConfig *network.NetworkingConfig, platform *ocispec.Platform, containerName string) (container.CreateResponse, error)
	ContainerStart(ctx context.Context, containerID string, options container.StartOptions) error
	ImagePull(ctx context.Context, refStr string, options image.PullOptions) (io.ReadCloser, error)
	ImageInspectWithRaw(ctx context.Context, imageID string) (image.InspectResponse, []byte, error)
	ImageList(ctx context.Context, options image.ListOptions) ([]image.Summary, error)
	ImageRemove(ctx context.Context, imageID string, options image.RemoveOptions) ([]image.DeleteResponse, error)
	NetworkConnect(ctx context.Context, networkID, containerID string, config *network.EndpointSettings) error
	ContainerRename(ctx context.Context, containerID, newName string) error
	ContainerLogs(ctx context.Context, containerID string, options container.LogsOptions) (io.ReadCloser, error)
	DistributionInspect(ctx context.Context, imageRef, encodedRegistryAuth string) (registry.DistributionInspect, error)
}

// ContainerInfo represents basic container information reported to the controller.
type ContainerInfo struct {
	ID            string   `json:"id"`
	DockerID      string   `json:"docker_id"`
	Name          string   `json:"name"`
	Image         string   `json:"image"`
	CurrentDigest string   `json:"current_digest"`
	Status        string   `json:"status"`
	Excluded      bool     `json:"excluded"`
	ExcludeReason string   `json:"exclude_reason,omitempty"`
	PinnedVersion bool     `json:"pinned_version,omitempty"`
	Group         string   `json:"group,omitempty"`
	Priority      int      `json:"priority,omitempty"`
	DependsOn     []string `json:"depends_on,omitempty"`
	Policy        string   `json:"policy,omitempty"`        // "auto", "notify", "manual" (from label)
	TagPattern    string   `json:"tag_pattern,omitempty"`   // regex for tag matching (from label)
	UpdateLevel   string   `json:"update_level,omitempty"`  // "major", "minor", "patch", "all" (from label)
	HealthStatus  string   `json:"health_status,omitempty"` // "healthy", "unhealthy", "starting", "none"
	IsStateful    bool     `json:"is_stateful,omitempty"`   // auto-detected database/stateful service
}

// ContainerSnapshot captures all parameters needed to recreate a container.
type ContainerSnapshot struct {
	Name        string
	ImageRef    string
	ImageDigest string
	Config      *container.Config
	HostConfig  *container.HostConfig
	Networks    map[string]*network.EndpointSettings
}

// CheckResult represents the result of checking a container for updates.
type CheckResult struct {
	ContainerID   string     `json:"containerId"`
	ContainerName string     `json:"containerName"`
	CurrentDigest string     `json:"currentDigest"`
	LatestDigest  string     `json:"latestDigest"`
	HasUpdate     bool       `json:"hasUpdate"`
	Diff          *ImageDiff `json:"diff,omitempty"`
	// CheckError is set when the check itself failed (e.g. network/pull error).
	// HasUpdate will be false and digests empty when this is non-empty.
	CheckError string `json:"checkError,omitempty"`
}

// UpdateResult represents the result of updating a container.
type UpdateResult struct {
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
	Success       bool   `json:"success"`
	OldDigest     string `json:"oldDigest,omitempty"`
	NewDigest     string `json:"newDigest,omitempty"`
	OldImage      string `json:"oldImage,omitempty"`
	NewImage      string `json:"newImage,omitempty"`
	Error         string `json:"error,omitempty"`
	DurationMs    int64  `json:"durationMs,omitempty"`
	IsRollback    bool   `json:"isRollback,omitempty"`
	// OriginalContainerID is the container ID that was passed to the update/rollback
	// function (the pre-recreation ID). ContainerID holds the new container's ID on
	// success. The UI keys update-progress by the original ID, so this field lets
	// it clear the correct entry from the store after update.
	OriginalContainerID string `json:"originalContainerId,omitempty"`
}

// DockerVersionInfo holds Docker server version details.
type DockerVersionInfo struct {
	ServerVersion string `json:"serverVersion"`
	APIVersion    string `json:"apiVersion"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
}

// Message is the WebSocket message envelope.
type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// ScanResult holds vulnerability scan results for a container image.
type ScanResult struct {
	ContainerID   string       `json:"containerId"`
	ContainerName string       `json:"containerName"`
	Image         string       `json:"image"`
	Critical      int          `json:"critical"`
	High          int          `json:"high"`
	Medium        int          `json:"medium"`
	Low           int          `json:"low"`
	Details       []VulnDetail `json:"details"`
}

// VulnDetail holds details about a single vulnerability.
type VulnDetail struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Package  string `json:"package"`
	Fixed    string `json:"fixed"`
}
