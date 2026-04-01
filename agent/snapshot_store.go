package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

const defaultSnapshotDir = "/var/lib/watchwarden/snapshots"

// snapshotOnDisk is a JSON-serializable wrapper for ContainerSnapshot.
type snapshotOnDisk struct {
	Name        string          `json:"name"`
	ImageRef    string          `json:"imageRef"`
	ImageDigest string          `json:"imageDigest"`
	Config      json.RawMessage `json:"config"`
	HostConfig  json.RawMessage `json:"hostConfig"`
	Networks    json.RawMessage `json:"networks"`
}

func snapshotDir() string {
	if d := os.Getenv("SNAPSHOT_DIR"); d != "" {
		return d
	}
	return defaultSnapshotDir
}

// saveSnapshot persists a ContainerSnapshot to disk so it survives restarts.
func saveSnapshot(containerID string, s *ContainerSnapshot) {
	dir := snapshotDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		log.Printf("[snapshot] cannot create dir %s: %v", dir, err)
		return
	}

	cfg, err := json.Marshal(s.Config)
	if err != nil {
		log.Printf("[snapshot] marshal config for %s: %v", containerID, err)
		return
	}
	hc, err := json.Marshal(s.HostConfig)
	if err != nil {
		log.Printf("[snapshot] marshal hostConfig for %s: %v", containerID, err)
		return
	}
	nets, err := json.Marshal(s.Networks)
	if err != nil {
		log.Printf("[snapshot] marshal networks for %s: %v", containerID, err)
		return
	}

	disk := snapshotOnDisk{
		Name:        s.Name,
		ImageRef:    s.ImageRef,
		ImageDigest: s.ImageDigest,
		Config:      cfg,
		HostConfig:  hc,
		Networks:    nets,
	}

	data, err := json.Marshal(disk)
	if err != nil {
		log.Printf("[snapshot] marshal snapshot for %s: %v", containerID, err)
		return
	}

	// FIX-2.2: write-then-fsync so the snapshot is durable before any destructive
	// Docker operations (stop/remove). Without fsync, a power loss between
	// os.WriteFile and the kernel flushing dirty pages loses the snapshot,
	// making RecoverOrphans unable to restore the container.
	path := filepath.Join(dir, containerID+".json")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		log.Printf("[snapshot] open %s: %v", path, err)
		return
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		log.Printf("[snapshot] write %s: %v", path, err)
		return
	}
	if err := f.Sync(); err != nil {
		log.Printf("[snapshot] fsync %s: %v", path, err)
	}
	f.Close()
}

// loadSnapshots reads all persisted snapshots from disk into the given map.
func loadSnapshots(snapshots map[string]*ContainerSnapshot) {
	dir := snapshotDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[snapshot] read dir %s: %v", dir, err)
		}
		return
	}

	loaded := 0
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		containerID := e.Name()[:len(e.Name())-5] // strip .json

		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			log.Printf("[snapshot] read %s: %v", e.Name(), err)
			continue
		}

		var disk snapshotOnDisk
		if err := json.Unmarshal(data, &disk); err != nil {
			log.Printf("[snapshot] parse %s: %v", e.Name(), err)
			continue
		}

		s := &ContainerSnapshot{
			Name:        disk.Name,
			ImageRef:    disk.ImageRef,
			ImageDigest: disk.ImageDigest,
		}
		if err := json.Unmarshal(disk.Config, &s.Config); err != nil {
			log.Printf("[snapshot] parse config for %s: %v", containerID, err)
			continue
		}
		if err := json.Unmarshal(disk.HostConfig, &s.HostConfig); err != nil {
			log.Printf("[snapshot] parse hostConfig for %s: %v", containerID, err)
			continue
		}
		if err := json.Unmarshal(disk.Networks, &s.Networks); err != nil {
			log.Printf("[snapshot] parse networks for %s: %v", containerID, err)
			continue
		}

		snapshots[containerID] = s
		loaded++
	}

	if loaded > 0 {
		log.Printf("[snapshot] loaded %d snapshots from %s", loaded, dir)
	}
}

// deleteSnapshot removes a persisted snapshot file (optional cleanup).
func deleteSnapshot(containerID string) {
	path := filepath.Join(snapshotDir(), containerID+".json")
	_ = os.Remove(path)
}
