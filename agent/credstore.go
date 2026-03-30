package main

import (
	"strings"
	"sync"
)

// RegistryCredential holds auth info for a Docker registry.
type RegistryCredential struct {
	Registry string `json:"registry"`
	Username string `json:"username"`
	Password string `json:"password"`
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
