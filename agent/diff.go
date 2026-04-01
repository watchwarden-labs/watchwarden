package main

import (
	"sort"
	"strings"

	"github.com/docker/docker/api/types/image"
	"github.com/docker/go-connections/nat"
)

// ImageDiff represents the configuration differences between two image versions.
type ImageDiff struct {
	EnvAdded           []string          `json:"envAdded,omitempty"`
	EnvRemoved         []string          `json:"envRemoved,omitempty"`
	EnvChanged         []EnvChange       `json:"envChanged,omitempty"`
	PortsAdded         []string          `json:"portsAdded,omitempty"`
	PortsRemoved       []string          `json:"portsRemoved,omitempty"`
	EntrypointChanged  *StringSliceDiff  `json:"entrypointChanged,omitempty"`
	CmdChanged         *StringSliceDiff  `json:"cmdChanged,omitempty"`
	LabelsAdded        map[string]string `json:"labelsAdded,omitempty"`
	LabelsRemoved      []string          `json:"labelsRemoved,omitempty"`
	LabelsChanged      []LabelChange     `json:"labelsChanged,omitempty"`
	WorkdirChanged     *StringDiff       `json:"workdirChanged,omitempty"`
	UserChanged        *StringDiff       `json:"userChanged,omitempty"`
	VolumesAdded       []string          `json:"volumesAdded,omitempty"`
	VolumesRemoved     []string          `json:"volumesRemoved,omitempty"`
	HasBreakingChanges bool              `json:"hasBreakingChanges"`
	ChangeCount        int               `json:"changeCount"`
}

// EnvChange represents a changed environment variable.
type EnvChange struct {
	Key      string `json:"key"`
	OldValue string `json:"oldValue"`
	NewValue string `json:"newValue"`
}

// LabelChange represents a changed label.
type LabelChange struct {
	Key      string `json:"key"`
	OldValue string `json:"oldValue"`
	NewValue string `json:"newValue"`
}

// StringDiff represents a simple old→new string change.
type StringDiff struct {
	Old string `json:"old"`
	New string `json:"new"`
}

// StringSliceDiff represents a change in a string slice (entrypoint, cmd).
type StringSliceDiff struct {
	Old []string `json:"old"`
	New []string `json:"new"`
}

// DiffImages compares two Docker image inspections and returns the differences.
func DiffImages(current, target image.InspectResponse) ImageDiff {
	diff := ImageDiff{}

	if current.Config == nil || target.Config == nil {
		return diff
	}

	// Environment variables
	currentEnv := parseEnvMap(current.Config.Env)
	targetEnv := parseEnvMap(target.Config.Env)
	diff.EnvAdded, diff.EnvRemoved, diff.EnvChanged = diffEnv(currentEnv, targetEnv)

	// Exposed ports
	currentPorts := portKeys(current.Config.ExposedPorts)
	targetPorts := portKeys(target.Config.ExposedPorts)
	diff.PortsAdded = setDiff(targetPorts, currentPorts)
	diff.PortsRemoved = setDiff(currentPorts, targetPorts)

	// Entrypoint
	if !sliceEqual(current.Config.Entrypoint, target.Config.Entrypoint) {
		diff.EntrypointChanged = &StringSliceDiff{
			Old: current.Config.Entrypoint,
			New: target.Config.Entrypoint,
		}
	}

	// Cmd
	if !sliceEqual(current.Config.Cmd, target.Config.Cmd) {
		diff.CmdChanged = &StringSliceDiff{
			Old: current.Config.Cmd,
			New: target.Config.Cmd,
		}
	}

	// Labels
	diff.LabelsAdded, diff.LabelsRemoved, diff.LabelsChanged = diffLabels(
		current.Config.Labels, target.Config.Labels,
	)

	// WorkingDir
	if current.Config.WorkingDir != target.Config.WorkingDir {
		diff.WorkdirChanged = &StringDiff{
			Old: current.Config.WorkingDir,
			New: target.Config.WorkingDir,
		}
	}

	// User
	if current.Config.User != target.Config.User {
		diff.UserChanged = &StringDiff{
			Old: current.Config.User,
			New: target.Config.User,
		}
	}

	// Volumes
	currentVols := volumeKeys(current.Config.Volumes)
	targetVols := volumeKeys(target.Config.Volumes)
	diff.VolumesAdded = setDiff(targetVols, currentVols)
	diff.VolumesRemoved = setDiff(currentVols, targetVols)

	// Breaking changes: ports, entrypoint, or volumes changed
	diff.HasBreakingChanges = len(diff.PortsAdded) > 0 || len(diff.PortsRemoved) > 0 ||
		diff.EntrypointChanged != nil || len(diff.VolumesAdded) > 0 || len(diff.VolumesRemoved) > 0

	// Total change count
	diff.ChangeCount = len(diff.EnvAdded) + len(diff.EnvRemoved) + len(diff.EnvChanged) +
		len(diff.PortsAdded) + len(diff.PortsRemoved) +
		len(diff.LabelsAdded) + len(diff.LabelsRemoved) + len(diff.LabelsChanged) +
		len(diff.VolumesAdded) + len(diff.VolumesRemoved)
	if diff.EntrypointChanged != nil {
		diff.ChangeCount++
	}
	if diff.CmdChanged != nil {
		diff.ChangeCount++
	}
	if diff.WorkdirChanged != nil {
		diff.ChangeCount++
	}
	if diff.UserChanged != nil {
		diff.ChangeCount++
	}

	return diff
}

// --- helpers ---

func parseEnvMap(env []string) map[string]string {
	m := make(map[string]string, len(env))
	for _, e := range env {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			m[parts[0]] = parts[1]
		}
	}
	return m
}

func diffEnv(current, target map[string]string) (added, removed []string, changed []EnvChange) {
	for k, v := range target {
		if cv, ok := current[k]; !ok {
			added = append(added, k+"="+v)
		} else if cv != v {
			changed = append(changed, EnvChange{Key: k, OldValue: cv, NewValue: v})
		}
	}
	for k := range current {
		if _, ok := target[k]; !ok {
			removed = append(removed, k)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	return
}

// isMetadataLabel returns true for labels that are build metadata (change every
// release but have no runtime impact). These are excluded from changeCount so
// they don't inflate the diff with noise like version stamps and build dates.
func isMetadataLabel(key string) bool {
	return strings.HasPrefix(key, "org.opencontainers.image.") ||
		strings.HasPrefix(key, "org.label-schema.") ||
		key == "build_version" ||
		key == "maintainer"
}

func diffLabels(current, target map[string]string) (added map[string]string, removed []string, changed []LabelChange) {
	added = make(map[string]string)
	for k, v := range target {
		if isMetadataLabel(k) {
			continue
		}
		if cv, ok := current[k]; !ok {
			added[k] = v
		} else if cv != v {
			changed = append(changed, LabelChange{Key: k, OldValue: cv, NewValue: v})
		}
	}
	for k := range current {
		if isMetadataLabel(k) {
			continue
		}
		if _, ok := target[k]; !ok {
			removed = append(removed, k)
		}
	}
	sort.Strings(removed)
	return
}

func portKeys(ports nat.PortSet) []string {
	result := make([]string, 0, len(ports))
	for p := range ports {
		result = append(result, string(p))
	}
	sort.Strings(result)
	return result
}

func volumeKeys(vols map[string]struct{}) []string {
	result := make([]string, 0, len(vols))
	for v := range vols {
		result = append(result, v)
	}
	sort.Strings(result)
	return result
}

func setDiff(a, b []string) []string {
	bSet := make(map[string]bool, len(b))
	for _, v := range b {
		bSet[v] = true
	}
	var diff []string
	for _, v := range a {
		if !bSet[v] {
			diff = append(diff, v)
		}
	}
	return diff
}

func sliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
