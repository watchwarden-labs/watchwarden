package main

import (
	"context"
	"testing"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/image"
	"github.com/moby/moby/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeSnapshots struct {
	refs, keys []string
}

func (f fakeSnapshots) RollbackRefs() ([]string, []string) { return f.refs, f.keys }

func newTestPruner(mock *mockDockerAPI, snaps SnapshotSource) *Pruner {
	p := NewPruner(&DockerClient{cli: mock})
	if snaps != nil {
		p.SetSnapshotSource(snaps)
	}
	return p
}

func removedCalls(mock *mockDockerAPI, prefix string) []string {
	var out []string
	for _, c := range mock.getCalls() {
		if len(c) > len(prefix) && c[:len(prefix)] == prefix {
			out = append(out, c[len(prefix):])
		}
	}
	return out
}

func TestPrune_KeepsNewestPreviousRegardlessOfListOrder(t *testing.T) {
	mock := &mockDockerAPI{}
	// Deliberately NOT newest-first: Docker does not guarantee ordering.
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:old", Created: 100, RepoTags: []string{"app:1.0"}, Size: 10},
			{ID: "sha256:new", Created: 300, RepoTags: []string{"app:3.0"}, Size: 10},
			{ID: "sha256:mid", Created: 200, RepoTags: []string{"app:2.0"}, Size: 10},
			{ID: "sha256:cur", Created: 400, RepoTags: []string{"app:4.0"}, Size: 10},
		}, nil
	}
	mock.containers = []container.Summary{{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning}}

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 1}, nil)

	assert.Empty(t, res.Errors)
	assert.Equal(t, 2, res.ImagesRemoved)
	assert.ElementsMatch(t, []string{"app:2.0", "app:1.0"}, removedCalls(mock, "ImageRemove:"))
}

func TestPrune_KeepZeroRemovesAllUnused(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:a", Created: 1, RepoTags: []string{"app:1"}, Size: 5},
			{ID: "sha256:cur", Created: 2, RepoTags: []string{"app:2"}, Size: 5},
		}, nil
	}
	mock.containers = []container.Summary{{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning}}

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 0}, nil)

	assert.Equal(t, 1, res.ImagesRemoved)
	assert.Equal(t, []string{"app:1"}, removedCalls(mock, "ImageRemove:"))
}

func TestPrune_MultiTagImageRemovedOnceAndCountedOnce(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:multi", Created: 1, RepoTags: []string{"app:1.0", "app:stable"}, Size: 7},
			{ID: "sha256:cur", Created: 2, RepoTags: []string{"app:2.0"}, Size: 7},
		}, nil
	}
	mock.containers = []container.Summary{{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning}}

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 0, DryRun: true}, nil)
	assert.Equal(t, 1, res.ImagesRemoved, "multi-tag image must be counted once")
	assert.Equal(t, int64(7), res.SpaceReclaimed)

	res = newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 0}, nil)
	assert.Equal(t, 1, res.ImagesRemoved)
	// Each tag is untagged individually; removing by ID would fail with several tags.
	assert.Equal(t, []string{"app:1.0", "app:stable"}, removedCalls(mock, "ImageRemove:"))
}

func TestPrune_ImageSharedWithCurrentRepoIsKept(t *testing.T) {
	mock := &mockDockerAPI{}
	// Same image carries a tag in a repo that has no budget (other) and one in use (app).
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:cur", Created: 2, RepoTags: []string{"app:2.0", "mirror/app:2.0"}, Size: 7},
		}, nil
	}
	mock.containers = []container.Summary{{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning}}

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 0}, nil)
	assert.Equal(t, 0, res.ImagesRemoved)
	assert.Empty(t, removedCalls(mock, "ImageRemove:"))
}

func TestPrune_ProtectsRollbackTargets(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:prev", Created: 1, RepoTags: []string{"app:1.0"}, Size: 5},
			{ID: "sha256:bydigest", Created: 2, RepoDigests: []string{"app@sha256:feedbeef"}, Size: 5},
			{ID: "sha256:dangling", Created: 3, Size: 5},
			{ID: "sha256:cur", Created: 4, RepoTags: []string{"app:2.0"}, Size: 5},
		}, nil
	}
	mock.containers = []container.Summary{{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning}}
	snaps := fakeSnapshots{refs: []string{"app:1.0", "sha256:feedbeef"}}

	res := newTestPruner(mock, snaps).Prune(context.Background(), PruneOptions{KeepPrevious: 0}, nil)

	assert.Equal(t, 1, res.ImagesRemoved, "only the dangling image is unprotected")
	assert.Equal(t, []string{"sha256:dangling"}, removedCalls(mock, "ImageRemove:"))
}

func TestPrune_SpaceExcludesSharedLayers(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:a", Created: 1, RepoTags: []string{"app:1"}, Size: 100, SharedSize: 80},
			{ID: "sha256:cur", Created: 2, RepoTags: []string{"app:2"}, Size: 100, SharedSize: 80},
		}, nil
	}
	mock.containers = []container.Summary{{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning}}

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 0, DryRun: true}, nil)
	assert.Equal(t, int64(20), res.SpaceReclaimed)
}

func TestPrune_StoppedContainersOptIn(t *testing.T) {
	newMock := func() *mockDockerAPI {
		mock := &mockDockerAPI{}
		mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
			return []image.Summary{
				{ID: "sha256:stoppedimg", Created: 1, RepoTags: []string{"job:1"}, Size: 50},
			}, nil
		}
		mock.containers = []container.Summary{
			{ID: "stopped1", Names: []string{"/old-job"}, ImageID: "sha256:stoppedimg", State: container.StateExited, SizeRw: 3},
			{ID: "swapold", Names: []string{"/web-ww-old"}, ImageID: "sha256:x", State: container.StateExited},
			{ID: "snapped", Names: []string{"/snapped"}, ImageID: "sha256:y", State: container.StateExited},
		}
		return mock
	}
	snaps := fakeSnapshots{keys: []string{"snapped"}}

	t.Run("off by default", func(t *testing.T) {
		mock := newMock()
		res := newTestPruner(mock, snaps).Prune(context.Background(), PruneOptions{KeepPrevious: 0}, nil)
		assert.Equal(t, 0, res.ContainersRemoved)
		assert.Equal(t, 0, res.ImagesRemoved, "stopped container's image stays in use")
		assert.Empty(t, removedCalls(mock, "ContainerRemove:"))
	})

	t.Run("opt in removes stopped containers and frees their images", func(t *testing.T) {
		mock := newMock()
		var phases []string
		res := newTestPruner(mock, snaps).Prune(context.Background(),
			PruneOptions{KeepPrevious: 0, IncludeStopped: true},
			func(p PruneProgress) { phases = append(phases, p.Phase) })

		assert.Equal(t, []string{"stopped1"}, removedCalls(mock, "ContainerRemove:"),
			"temporary -ww-old and snapshot-protected containers are never removed")
		assert.Equal(t, 1, res.ContainersRemoved)
		assert.Equal(t, 1, res.ImagesRemoved)
		assert.Equal(t, int64(53), res.SpaceReclaimed)
		assert.Equal(t, []string{"containers", "images"}, phases)
	})
}

func TestPrune_DryRunRemovesNothing(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{{ID: "sha256:a", Created: 1, RepoTags: []string{"app:1"}, Size: 5}}, nil
	}
	mock.containers = []container.Summary{{ID: "s", Names: []string{"/s"}, ImageID: "sha256:z", State: container.StateExited}}

	var progress int
	res := newTestPruner(mock, nil).Prune(context.Background(),
		PruneOptions{DryRun: true, IncludeStopped: true}, func(PruneProgress) { progress++ })

	assert.True(t, res.DryRun)
	assert.Equal(t, 1, res.ImagesRemoved)
	assert.Equal(t, 1, res.ContainersRemoved)
	assert.Empty(t, removedCalls(mock, "ImageRemove:"))
	assert.Empty(t, removedCalls(mock, "ContainerRemove:"))
	assert.Zero(t, progress, "dry runs emit no progress")
}

func TestPrune_RemoveErrorsAreReportedAndDoNotStopTheRun(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:a", Created: 1, RepoTags: []string{"a:1"}, Size: 5},
			{ID: "sha256:b", Created: 2, RepoTags: []string{"b:1"}, Size: 5},
		}, nil
	}
	mock.imageRemoveFn = func(ref string) error {
		if ref == "a:1" {
			return assert.AnError
		}
		return nil
	}

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{KeepPrevious: 0}, nil)
	require.Len(t, res.Errors, 1)
	assert.Contains(t, res.Errors[0], "a:1")
	assert.Equal(t, 1, res.ImagesRemoved)
}

func TestPrune_ListFailureIsReported(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) { return nil, assert.AnError }

	res := newTestPruner(mock, nil).Prune(context.Background(), PruneOptions{}, nil)
	require.Len(t, res.Errors, 1)
	assert.Contains(t, res.Errors[0], "failed to list images")
	assert.NotNil(t, res.Details, "details must serialize as [] not null")
}

func TestPrunePreview_SummarisesUsageAndCandidates(t *testing.T) {
	mock := &mockDockerAPI{}
	mock.imageListFn = func(client.ImageListOptions) ([]image.Summary, error) {
		return []image.Summary{
			{ID: "sha256:a", Created: 1, RepoTags: []string{"app:1"}, Size: 40},
			{ID: "sha256:cur", Created: 2, RepoTags: []string{"app:2"}, Size: 40},
		}, nil
	}
	mock.containers = []container.Summary{
		{ID: "c1", ImageID: "sha256:cur", State: container.StateRunning},
		{ID: "s1", Names: []string{"/s1"}, ImageID: "sha256:q", State: container.StateExited, SizeRw: 9},
	}
	mock.diskUsage.Images.TotalCount = 2
	mock.diskUsage.Images.TotalSize = 70

	off := newTestPruner(mock, nil).Preview(context.Background(), PruneOptions{KeepPrevious: 0})
	assert.Equal(t, int64(2), off.TotalImages)
	assert.Equal(t, int64(70), off.TotalImageSize)
	assert.Equal(t, 1, off.RemovableImages)
	assert.Equal(t, int64(40), off.RemovableSize)
	assert.Equal(t, 1, off.StoppedContainers, "stopped containers are reported even when not opted in")
	assert.Len(t, off.Items, 1, "but they are only listed as removable items when opted in")

	on := newTestPruner(mock, nil).Preview(context.Background(), PruneOptions{KeepPrevious: 0, IncludeStopped: true})
	assert.Equal(t, 1, on.StoppedContainers)
	assert.Equal(t, int64(9), on.StoppedSize)
	assert.Empty(t, removedCalls(mock, "ImageRemove:"))
	assert.Empty(t, removedCalls(mock, "ContainerRemove:"))
}

func TestMatchesRollbackRef_NormalizesDockerHubNames(t *testing.T) {
	img := image.Summary{ID: "sha256:x", RepoTags: []string{"nginx:latest"}}
	assert.True(t, matchesRollbackRef(img, map[string]bool{normalizeRef("docker.io/library/nginx"): true}))
	assert.False(t, matchesRollbackRef(img, map[string]bool{normalizeRef("nginx:1.25"): true}))
}
