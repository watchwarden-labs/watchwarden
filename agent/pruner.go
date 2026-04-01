package main

import (
	"context"
	"log"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
)

// PruneResult holds the outcome of an image prune operation.
type PruneResult struct {
	ImagesRemoved  int           `json:"imagesRemoved"`
	SpaceReclaimed int64         `json:"spaceReclaimed"`
	Details        []PrunedImage `json:"details"`
	Errors         []string      `json:"errors"`
}

// PrunedImage describes a single removed image.
type PrunedImage struct {
	Image string `json:"image"`
	Size  int64  `json:"size"`
}

// Pruner handles cleaning up old Docker images.
type Pruner struct {
	docker *DockerClient
}

// NewPruner creates a new Pruner.
func NewPruner(docker *DockerClient) *Pruner {
	return &Pruner{docker: docker}
}

// Prune removes unused images while keeping images used by running containers
// and up to keepPrevious historical images per container.
// If dryRun is true, it reports what would be removed without actually removing.
func (p *Pruner) Prune(ctx context.Context, keepPrevious int, dryRun bool) PruneResult {
	result := PruneResult{}

	// 1. Get all running containers to find images in use
	containers, err := p.docker.cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		result.Errors = append(result.Errors, "failed to list containers: "+err.Error())
		return result
	}

	// Build set of image IDs in use by containers
	usedImages := make(map[string]bool)
	for _, c := range containers {
		usedImages[c.ImageID] = true
	}

	// 2. List all images
	images, err := p.docker.cli.ImageList(ctx, image.ListOptions{All: false})
	if err != nil {
		result.Errors = append(result.Errors, "failed to list images: "+err.Error())
		return result
	}

	// 3. Group images by repository (base name without tag)
	type repoImage struct {
		summary image.Summary
		repo    string
		tag     string
	}

	repoGroups := make(map[string][]repoImage)
	var danglingImages []image.Summary

	for _, img := range images {
		if len(img.RepoTags) == 0 {
			// Dangling image (no tags)
			if !usedImages[img.ID] {
				danglingImages = append(danglingImages, img)
			}
			continue
		}
		for _, tag := range img.RepoTags {
			repo, tagName := splitRepoTag(tag)
			repoGroups[repo] = append(repoGroups[repo], repoImage{
				summary: img,
				repo:    repo,
				tag:     tagName,
			})
		}
	}

	// 4. For each repo, keep the newest keepPrevious+1 images (current + N previous)
	for _, imgs := range repoGroups {
		// Sort by creation time descending (newest first) — images already sorted by Docker
		if len(imgs) <= keepPrevious+1 {
			continue // nothing to prune
		}

		// Skip images in use and mark oldest for removal
		kept := 0
		for _, img := range imgs {
			if usedImages[img.summary.ID] {
				continue // always keep images used by containers
			}
			kept++
			if kept <= keepPrevious {
				continue // keep N previous
			}
			// This image is a candidate for removal
			p.removeImage(ctx, &result, img.summary, img.repo+":"+img.tag, dryRun)
		}
	}

	// 5. Remove dangling images
	for _, img := range danglingImages {
		name := img.ID
		if len(name) > 19 {
			name = name[:19]
		}
		p.removeImage(ctx, &result, img, name, dryRun)
	}

	log.Printf("[pruner] removed %d images, reclaimed %d bytes (dry_run=%v)",
		result.ImagesRemoved, result.SpaceReclaimed, dryRun)

	return result
}

func (p *Pruner) removeImage(ctx context.Context, result *PruneResult, img image.Summary, name string, dryRun bool) {
	if dryRun {
		result.ImagesRemoved++
		result.SpaceReclaimed += img.Size
		result.Details = append(result.Details, PrunedImage{Image: name, Size: img.Size})
		return
	}

	_, err := p.docker.cli.ImageRemove(ctx, img.ID, image.RemoveOptions{PruneChildren: true})
	if err != nil {
		result.Errors = append(result.Errors, "failed to remove "+name+": "+err.Error())
		return
	}
	result.ImagesRemoved++
	result.SpaceReclaimed += img.Size
	result.Details = append(result.Details, PrunedImage{Image: name, Size: img.Size})
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
