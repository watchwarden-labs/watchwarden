package main

import (
	"context"
	"log"
	"time"
)

// Version is set at build time via -ldflags="-X main.Version=..."
// Falls back to "dev" for local development builds.
var Version = "dev"

func main() {
	// 1. Load and validate configuration
	cfg := loadConfig()
	if err := cfg.validate(); err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// 2. Init credential store
	credStore := NewCredStore()
	credStore.LoadFromEnv()

	// 3. Init Docker client
	dockerClient, err := NewDockerClient(cfg.LabelEnableOnly)
	if err != nil {
		log.Fatalf("Failed to create Docker client: %v", err)
	}
	dockerClient.credStore = credStore

	// 4. Init core components
	updater := NewUpdater(dockerClient)
	registryClient := NewRegistryClient(credStore)
	updater.SetRegistryClient(registryClient)
	pruner := NewPruner(dockerClient)
	scanner := NewScanner()

	// 5. Init image signature verifier (optional)
	verifier := NewVerifier(cfg.RequireSigned, cfg.CosignPublicKey)
	if verifier != nil {
		updater.SetVerifier(verifier)
		defer verifier.Close()
	}

	// 6. Recover orphaned containers from snapshots
	recoverCtx, recoverCancel := context.WithTimeout(context.Background(), 60*time.Second)
	updater.RecoverOrphans(recoverCtx)
	recoverCancel()

	// 7. Fetch Docker version
	dockerVer := dockerClient.GetDockerVersion(context.Background())
	if dockerVer != nil {
		log.Printf("Docker %s (API %s) on %s/%s", dockerVer.ServerVersion, dockerVer.APIVersion, dockerVer.OS, dockerVer.Arch)
	}

	// 8. Start in the appropriate mode
	if cfg.ControllerURL != "" {
		runManagedMode(cfg, credStore, dockerClient, updater, pruner, scanner, dockerVer)
	} else {
		runSoloMode(cfg, dockerClient, updater, pruner, scanner, dockerVer)
	}
}
