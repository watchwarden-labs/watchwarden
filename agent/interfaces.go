package main

import (
	"context"
	"io"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
)

// DockerAPI abstracts Docker operations for testability.
type DockerAPI interface {
	ContainerList(ctx context.Context, options container.ListOptions) ([]types.Container, error)
	ContainerInspect(ctx context.Context, containerID string) (types.ContainerJSON, error)
	ContainerStop(ctx context.Context, containerID string, options container.StopOptions) error
	ContainerRemove(ctx context.Context, containerID string, options container.RemoveOptions) error
	ContainerCreate(ctx context.Context, config *container.Config, hostConfig *container.HostConfig, networkingConfig *network.NetworkingConfig, platform *ocispec.Platform, containerName string) (container.CreateResponse, error)
	ContainerStart(ctx context.Context, containerID string, options container.StartOptions) error
	ImagePull(ctx context.Context, refStr string, options image.PullOptions) (io.ReadCloser, error)
	ImageInspectWithRaw(ctx context.Context, imageID string) (types.ImageInspect, []byte, error)
	ImageList(ctx context.Context, options image.ListOptions) ([]image.Summary, error)
	ImageRemove(ctx context.Context, imageID string, options image.RemoveOptions) ([]image.DeleteResponse, error)
	NetworkConnect(ctx context.Context, networkID, containerID string, config *network.EndpointSettings) error
	ContainerRename(ctx context.Context, containerID, newName string) error
	ContainerLogs(ctx context.Context, containerID string, options container.LogsOptions) (io.ReadCloser, error)
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
	ContainerID   string    `json:"containerId"`
	ContainerName string    `json:"containerName"`
	CurrentDigest string    `json:"currentDigest"`
	LatestDigest  string    `json:"latestDigest"`
	HasUpdate     bool      `json:"hasUpdate"`
	Diff          *ImageDiff `json:"diff,omitempty"`
}

// UpdateResult represents the result of updating a container.
type UpdateResult struct {
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
	Success       bool   `json:"success"`
	OldDigest     string `json:"oldDigest,omitempty"`
	NewDigest     string `json:"newDigest,omitempty"`
	Error         string `json:"error,omitempty"`
	DurationMs    int64  `json:"durationMs,omitempty"`
	IsRollback    bool   `json:"isRollback,omitempty"`
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
