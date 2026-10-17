package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/image"
	"github.com/moby/moby/client"
)

const (
	pruneKindImage     = "image"
	pruneKindContainer = "container"

	maxKeepPrevious = 10
)

// PruneOptions controls a prune run.
type PruneOptions struct {
	// KeepPrevious is how many unused older versions to keep per repository.
	KeepPrevious int
	// DryRun reports what would be removed without removing it.
	DryRun bool
	// IncludeStopped also removes stopped (exited/created/dead) containers.
	IncludeStopped bool
}

// PrunedItem describes a single removed (or, in a dry run, removable) object.
type PrunedItem struct {
	Image string `json:"image"` // image reference/ID or container name
	Size  int64  `json:"size"`
	Kind  string `json:"kind"` // "image" or "container"
}

// PruneResult holds the outcome of a prune operation.
type PruneResult struct {
	RequestID         string       `json:"requestId,omitempty"`
	DryRun            bool         `json:"dryRun"`
	ImagesRemoved     int          `json:"imagesRemoved"`
	ContainersRemoved int          `json:"containersRemoved"`
	SpaceReclaimed    int64        `json:"spaceReclaimed"`
	Details           []PrunedItem `json:"details"`
	Errors            []string     `json:"errors"`
}

// PrunePreview summarises disk usage and what a prune would remove.
type PrunePreview struct {
	RequestID         string `json:"requestId,omitempty"`
	TotalImages       int64  `json:"totalImages"`
	TotalImageSize    int64  `json:"totalImageSize"`
	RemovableImages   int    `json:"removableImages"`
	RemovableSize     int64  `json:"removableSize"`
	StoppedContainers int    `json:"stoppedContainers"`
	StoppedSize       int64  `json:"stoppedSize"`
	// IncludeStopped echoes whether stopped containers are part of Items;
	// StoppedContainers/StoppedSize are reported either way.
	IncludeStopped bool         `json:"includeStopped"`
	Items          []PrunedItem `json:"items"`
	Error          string       `json:"error,omitempty"`
}

// PruneProgress is emitted after each removal during a real prune run.
type PruneProgress struct {
	Phase   string `json:"phase"` // "containers" or "images"
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Current string `json:"current"`
}

// SnapshotSource exposes what the updater keeps for rollback so pruning never
// deletes a rollback target.
type SnapshotSource interface {
	// RollbackRefs returns image references/digests and container IDs/names
	// that rollback depends on.
	RollbackRefs() (imageRefs []string, containerKeys []string)
}

// Pruner handles cleaning up old Docker images (and optionally stopped containers).
type Pruner struct {
	docker    *DockerClient
	snapshots SnapshotSource
	running   sync.Mutex
}

// NewPruner creates a new Pruner.
func NewPruner(docker *DockerClient) *Pruner {
	return &Pruner{docker: docker}
}

// SetSnapshotSource wires the updater's rollback data into the pruner.
func (p *Pruner) SetSnapshotSource(s SnapshotSource) { p.snapshots = s }

// TryLock reports whether a prune run could be started; callers must Unlock.
func (p *Pruner) TryLock() bool { return p.running.TryLock() }

// Unlock releases the run lock taken by TryLock.
func (p *Pruner) Unlock() { p.running.Unlock() }

type pruneImage struct {
	summary image.Summary
	repos   map[string]bool
	size    int64 // estimated space freed (excludes layers shared with other images)
}

type prunePlan struct {
	containers []container.Summary
	images     []pruneImage
}

// uniqueSize is the space freed by removing an image: layers shared with other
// images stay on disk, so they are not counted.
func uniqueSize(img image.Summary) int64 {
	if img.SharedSize > 0 && img.SharedSize <= img.Size {
		return img.Size - img.SharedSize
	}
	return img.Size
}

func isStopped(c container.Summary) bool {
	switch c.State {
	case container.StateExited, container.StateCreated, container.StateDead:
		return true
	}
	return false
}

func containerName(c container.Summary) string {
	if len(c.Names) > 0 {
		return strings.TrimPrefix(c.Names[0], "/")
	}
	if len(c.ID) > 12 {
		return c.ID[:12]
	}
	return c.ID
}

// normalizeRef makes "docker.io/library/nginx" and "nginx" comparable.
func normalizeRef(ref string) string {
	ref = strings.TrimPrefix(ref, "docker.io/")
	ref = strings.TrimPrefix(ref, "library/")
	if !strings.Contains(ref, "@") {
		if _, tag := splitRepoTag(ref); tag == "latest" && !strings.HasSuffix(ref, ":latest") {
			return ref + ":latest"
		}
	}
	return ref
}

// matchesRollbackRef reports whether an image is referenced by a rollback ref
// (tag, repo digest, bare digest or image ID).
func matchesRollbackRef(img image.Summary, refs map[string]bool) bool {
	if refs[img.ID] {
		return true
	}
	for _, t := range img.RepoTags {
		if refs[normalizeRef(t)] {
			return true
		}
	}
	for _, d := range img.RepoDigests {
		if refs[normalizeRef(d)] {
			return true
		}
		if i := strings.Index(d, "@"); i >= 0 && refs[d[i+1:]] {
			return true
		}
	}
	return false
}

// plan decides what a prune with the given options would remove.
func (p *Pruner) plan(ctx context.Context, opts PruneOptions) (*prunePlan, error) {
	listed, err := p.docker.cli.ContainerList(ctx, client.ContainerListOptions{All: true, Size: opts.IncludeStopped})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var protectedRefs, protectedContainers map[string]bool
	if p.snapshots != nil {
		refs, keys := p.snapshots.RollbackRefs()
		protectedRefs = make(map[string]bool, len(refs))
		for _, r := range refs {
			if r != "" {
				protectedRefs[normalizeRef(r)] = true
				protectedRefs[r] = true
			}
		}
		protectedContainers = make(map[string]bool, len(keys))
		for _, k := range keys {
			protectedContainers[k] = true
		}
	} else {
		protectedRefs = map[string]bool{}
		protectedContainers = map[string]bool{}
	}

	plan := &prunePlan{}
	used := make(map[string]bool)
	for _, c := range listed.Items {
		name := containerName(c)
		removable := opts.IncludeStopped && isStopped(c) &&
			!protectedContainers[c.ID] && !protectedContainers[name] &&
			!strings.HasSuffix(name, "-ww-old") && !strings.HasSuffix(name, "-ww-new")
		if removable {
			plan.containers = append(plan.containers, c)
			continue // its image no longer counts as in use
		}
		used[c.ImageID] = true
	}

	imgs, err := p.docker.cli.ImageList(ctx, client.ImageListOptions{All: false, SharedSize: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list images: %w", err)
	}

	// Newest first so "keep N previous" keeps the N newest unused versions.
	items := append([]image.Summary(nil), imgs.Items...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].Created > items[j].Created })

	// An image is "kept" if in use / rollback-protected, or within the keep
	// budget of any repository it is tagged in.
	kept := make(map[string]bool)
	budget := make(map[string]int)
	for _, img := range items {
		if used[img.ID] || matchesRollbackRef(img, protectedRefs) {
			kept[img.ID] = true
		}
	}
	repos := func(img image.Summary) map[string]bool {
		set := map[string]bool{}
		for _, t := range img.RepoTags {
			r, _ := splitRepoTag(t)
			set[r] = true
		}
		return set
	}
	for _, img := range items {
		for r := range repos(img) {
			if _, ok := budget[r]; !ok {
				budget[r] = opts.KeepPrevious
			}
		}
	}
	for _, img := range items {
		if kept[img.ID] {
			continue
		}
		for r := range repos(img) {
			if budget[r] > 0 {
				budget[r]--
				kept[img.ID] = true
			}
		}
	}

	seen := make(map[string]bool)
	for _, img := range items {
		if kept[img.ID] || seen[img.ID] {
			continue
		}
		seen[img.ID] = true
		plan.images = append(plan.images, pruneImage{summary: img, repos: repos(img), size: uniqueSize(img)})
	}
	return plan, nil
}

func imageLabel(img image.Summary) string {
	if len(img.RepoTags) > 0 {
		return strings.Join(img.RepoTags, ", ")
	}
	name := img.ID
	if len(name) > 19 {
		name = name[:19]
	}
	return name
}

// Preview reports disk usage and what Prune would remove, without changing anything.
func (p *Pruner) Preview(ctx context.Context, opts PruneOptions) PrunePreview {
	out := PrunePreview{IncludeStopped: opts.IncludeStopped, Items: []PrunedItem{}}
	plan, err := p.plan(ctx, opts)
	if err != nil {
		out.Error = err.Error()
		return out
	}
	if du, err := p.docker.cli.DiskUsage(ctx, client.DiskUsageOptions{Images: true}); err == nil {
		out.TotalImages = du.Images.TotalCount
		out.TotalImageSize = du.Images.TotalSize
	} else {
		log.Printf("[pruner] disk usage unavailable: %v", err)
	}
	for _, img := range plan.images {
		out.RemovableImages++
		out.RemovableSize += img.size
		out.Items = append(out.Items, PrunedItem{Image: imageLabel(img.summary), Size: img.size, Kind: pruneKindImage})
	}
	// Stopped containers are always counted so the UI can show what the opt-in
	// would remove; they only become items when the caller opted in.
	stopped := plan
	if !opts.IncludeStopped {
		withStopped := opts
		withStopped.IncludeStopped = true
		if sp, err := p.plan(ctx, withStopped); err == nil {
			stopped = sp
		}
	}
	for _, c := range stopped.containers {
		out.StoppedContainers++
		out.StoppedSize += c.SizeRw
		if opts.IncludeStopped {
			out.Items = append(out.Items, PrunedItem{Image: containerName(c), Size: c.SizeRw, Kind: pruneKindContainer})
		}
	}
	return out
}

// Prune removes unused images, keeping images used by containers, images that
// rollback depends on, and up to KeepPrevious unused versions per repository.
// With IncludeStopped it also removes stopped containers first, which can
// release more images. onProgress (optional) is called after each removal.
func (p *Pruner) Prune(ctx context.Context, opts PruneOptions, onProgress func(PruneProgress)) PruneResult {
	result := PruneResult{DryRun: opts.DryRun, Details: []PrunedItem{}, Errors: []string{}}
	if opts.KeepPrevious < 0 {
		opts.KeepPrevious = 1
	}
	if opts.KeepPrevious > maxKeepPrevious {
		opts.KeepPrevious = maxKeepPrevious
	}

	plan, err := p.plan(ctx, opts)
	if err != nil {
		result.Errors = append(result.Errors, err.Error())
		return result
	}
	emit := func(phase string, done, total int, current string) {
		if onProgress != nil && !opts.DryRun {
			onProgress(PruneProgress{Phase: phase, Done: done, Total: total, Current: current})
		}
	}

	for i, c := range plan.containers {
		name := containerName(c)
		if !opts.DryRun {
			if _, err := p.docker.cli.ContainerRemove(ctx, c.ID, client.ContainerRemoveOptions{}); err != nil {
				result.Errors = append(result.Errors, "failed to remove container "+name+": "+err.Error())
				emit("containers", i+1, len(plan.containers), name)
				continue
			}
		}
		result.ContainersRemoved++
		result.SpaceReclaimed += c.SizeRw
		result.Details = append(result.Details, PrunedItem{Image: name, Size: c.SizeRw, Kind: pruneKindContainer})
		emit("containers", i+1, len(plan.containers), name)
	}

	for i, img := range plan.images {
		label := imageLabel(img.summary)
		if !opts.DryRun {
			if err := p.removeImage(ctx, img.summary); err != nil {
				result.Errors = append(result.Errors, "failed to remove "+label+": "+err.Error())
				emit("images", i+1, len(plan.images), label)
				continue
			}
		}
		result.ImagesRemoved++
		result.SpaceReclaimed += img.size
		result.Details = append(result.Details, PrunedItem{Image: label, Size: img.size, Kind: pruneKindImage})
		emit("images", i+1, len(plan.images), label)
	}

	log.Printf("[pruner] removed %d images and %d containers, reclaimed ~%d bytes (dry_run=%v)",
		result.ImagesRemoved, result.ContainersRemoved, result.SpaceReclaimed, opts.DryRun)
	return result
}

// removeImage untags every reference one by one (removing an image by ID
// fails when it carries several tags); the last untag deletes the image.
func (p *Pruner) removeImage(ctx context.Context, img image.Summary) error {
	rmOpts := client.ImageRemoveOptions{PruneChildren: true}
	if len(img.RepoTags) == 0 {
		_, err := p.docker.cli.ImageRemove(ctx, img.ID, rmOpts)
		return err
	}
	for _, tag := range img.RepoTags {
		if _, err := p.docker.cli.ImageRemove(ctx, tag, rmOpts); err != nil {
			return err
		}
	}
	return nil
}

// splitRepoTag splits "nginx:latest" into ("nginx", "latest").
func splitRepoTag(repoTag string) (string, string) {
	for i := len(repoTag) - 1; i >= 0; i-- {
		if repoTag[i] == ':' {
			return repoTag[:i], repoTag[i+1:]
		}
		if repoTag[i] == '/' {
			break
		}
	}
	return repoTag, "latest"
}
