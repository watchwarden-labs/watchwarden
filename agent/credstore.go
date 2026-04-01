package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// RegistryCredential holds auth info for a Docker registry.
type RegistryCredential struct {
	Registry string `json:"registry"`
	Username string `json:"username"`
	Password string `json:"password"`
	AuthType string `json:"auth_type,omitempty"` // "basic" (default), "ecr", "gcr", "acr"
}

// CredStore stores registry credentials synced from the controller.
type CredStore struct {
	mu    sync.RWMutex
	creds []RegistryCredential
}

// NewCredStore creates an empty credential store.
func NewCredStore() *CredStore {
	return &CredStore{}
}

// Set replaces all stored credentials.
func (s *CredStore) Set(creds []RegistryCredential) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.creds = creds
}

// Add appends a single credential, replacing any existing entry for the same registry.
func (s *CredStore) Add(cred RegistryCredential) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, existing := range s.creds {
		if existing.Registry == cred.Registry {
			s.creds[i] = cred
			return
		}
	}
	s.creds = append(s.creds, cred)
}

// LoadFromEnv reads registry credentials from WW_DOCKER_* env vars
// and WW_REGISTRY_AUTH (JSON array) into the store.
func (s *CredStore) LoadFromEnv() {
	username := os.Getenv("WW_DOCKER_USERNAME")
	password := os.Getenv("WW_DOCKER_PASSWORD")
	if username != "" && password != "" {
		server := os.Getenv("WW_DOCKER_SERVER")
		if server == "" {
			server = "index.docker.io"
		}
		s.Add(RegistryCredential{Registry: server, Username: username, Password: password})
		log.Printf("[credstore] Loaded credentials for %s from env", server)
	}

	if authJSON := os.Getenv("WW_REGISTRY_AUTH"); authJSON != "" {
		var creds []RegistryCredential
		if err := json.Unmarshal([]byte(authJSON), &creds); err != nil {
			log.Printf("[credstore] Failed to parse WW_REGISTRY_AUTH: %v", err)
		} else {
			for _, c := range creds {
				s.Add(c)
			}
			log.Printf("[credstore] Loaded %d registries from WW_REGISTRY_AUTH", len(creds))
		}
	}
}

// GetForImage returns credentials matching the image's registry, or nil.
func (s *CredStore) GetForImage(image string) *RegistryCredential {
	s.mu.RLock()
	defer s.mu.RUnlock()

	registry := parseRegistry(image)
	for i := range s.creds {
		if s.creds[i].Registry == registry {
			return &s.creds[i]
		}
	}
	return nil
}

// parseRegistry extracts the registry hostname from a Docker image reference.
func parseRegistry(image string) string {
	// Remove tag/digest
	ref := image
	if atIdx := strings.Index(ref, "@"); atIdx != -1 {
		ref = ref[:atIdx]
	}
	if colonIdx := strings.LastIndex(ref, ":"); colonIdx != -1 {
		// Only strip if after last slash (it's a tag, not a port)
		if slashIdx := strings.LastIndex(ref, "/"); colonIdx > slashIdx {
			ref = ref[:colonIdx]
		}
	}

	// If no slash → official Docker Hub image (e.g., "nginx")
	if !strings.Contains(ref, "/") {
		return "index.docker.io"
	}

	parts := strings.SplitN(ref, "/", 2)
	first := parts[0]

	// If first part contains a dot or colon → it's a registry hostname
	if strings.Contains(first, ".") || strings.Contains(first, ":") {
		return first
	}

	// Otherwise it's a Docker Hub user/org (e.g., "library/nginx")
	return "index.docker.io"
}

// StartCloudTokenRefresh starts background goroutines to refresh tokens
// for cloud registries (ECR, GCR, ACR) that use short-lived credentials.
func (s *CredStore) StartCloudTokenRefresh(ctx context.Context) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.creds {
		switch c.AuthType {
		case "ecr":
			region := os.Getenv("AWS_REGION")
			if region == "" {
				region = os.Getenv("AWS_DEFAULT_REGION")
			}
			if region == "" {
				region = "us-east-1"
			}
			s.startTokenRefresh(ctx, c.Registry, "ecr", region, 10*time.Hour)
		}
		// GCR and ACR use long-lived service account keys / client secrets,
		// so they work with standard basic auth and don't need refresh.
	}
}

func (s *CredStore) startTokenRefresh(ctx context.Context, registry, authType, region string, interval time.Duration) {
	go func() {
		s.refreshCloudToken(registry, authType, region)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.refreshCloudToken(registry, authType, region)
			}
		}
	}()
}

func (s *CredStore) refreshCloudToken(registry, authType, region string) {
	switch authType {
	case "ecr":
		password, err := getECRPassword(region)
		if err != nil {
			log.Printf("[credstore] ECR token refresh failed for %s: %v", registry, err)
			return
		}
		s.mu.Lock()
		for i := range s.creds {
			if s.creds[i].Registry == registry && s.creds[i].AuthType == "ecr" {
				s.creds[i].Username = "AWS"
				s.creds[i].Password = password
			}
		}
		s.mu.Unlock()
		log.Printf("[credstore] ECR token refreshed for %s", registry)
	}
}

// getECRPassword retrieves a Docker login password from AWS ECR using the AWS CLI.
// Requires the AWS CLI to be installed and configured (via env vars or instance role).
func getECRPassword(region string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "aws", "ecr", "get-login-password", "--region", region)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("aws ecr get-login-password failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}
